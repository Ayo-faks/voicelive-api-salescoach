"""Voice-agent action service.

Owns *all* mutating actions proposed by the voice agent. The model never
mutates state on its own; it can only propose actions through the planner
contract (``VoiceAgentActionSuggestion``). The user must confirm — either
by tapping a confirmation button or by an explicit voice "yes / confirm" —
and the server independently re-validates RBAC and parameters before
dispatching to the underlying Learning API.

Flow::

    suggest()  -> store proposal, return suggestion_id (idempotent by hash)
    confirm()  -> mark suggestion as user-confirmed
    execute()  -> validate, dispatch, record audit, return result

All state is in-memory for now (matches existing ``LearningApi`` patterns).
A future migration can persist ``insight_action_logs`` to Postgres.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple
from uuid import uuid4

from src.services.voice_agent_contracts import (
    ACTION_TYPES,
    RISK_LEVELS,
    sanitize_action_suggestions,
)

logger = logging.getLogger(__name__)

# Suggestions expire after this window to avoid stale state being executed.
SUGGESTION_TTL_SECONDS = 10 * 60


class VoiceAgentActionError(Exception):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _hash_action(action_type: str, parameters: Mapping[str, Any]) -> str:
    blob = json.dumps(
        {"t": action_type, "p": parameters},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


class VoiceAgentActionService:
    """Whitelist-enforced, audit-logged action executor."""

    def __init__(self, *, learning_api: Any, clock: Optional[Callable[[], float]] = None) -> None:
        self.learning_api = learning_api
        self._clock = clock or time.monotonic
        self._lock = threading.Lock()
        # suggestion_id -> record
        self._suggestions: Dict[str, Dict[str, Any]] = {}
        # idempotency_hash -> result (so re-execute returns the same payload)
        self._completed_by_hash: Dict[str, Dict[str, Any]] = {}
        self._audit: List[Dict[str, Any]] = []
        self._metrics: Dict[str, int] = {
            "suggested": 0,
            "confirmed": 0,
            "executed_success": 0,
            "executed_denied": 0,
            "executed_failed": 0,
        }
        self._dispatch: Dict[str, Callable[[str, Dict[str, Any], Dict[str, Any]], Dict[str, Any]]] = {
            "approve_learning_plan": self._do_approve_plan,
            "reject_learning_plan": self._do_reject_plan,
            "edit_approve_learning_plan": self._do_edit_approve_plan,
            "submit_learning_intent": self._do_submit_intent,
            "create_intervention_plan_draft": self._do_submit_intent,
            "open_student_profile": self._do_open_student_profile,
        }

    # -- Public API ---------------------------------------------------------

    @property
    def metrics(self) -> Dict[str, int]:
        return dict(self._metrics)

    def list_audit(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._audit[-max(1, min(limit, 500)):])

    def suggest(self, *, user_id: str, suggestion: Mapping[str, Any]) -> Dict[str, Any]:
        cleaned_list = sanitize_action_suggestions([dict(suggestion)])
        if not cleaned_list:
            raise VoiceAgentActionError("invalid suggestion", status_code=400)
        cleaned = cleaned_list[0]
        idem_hash = _hash_action(cleaned["action_type"], cleaned["parameters"])
        with self._lock:
            # Reuse existing suggestion if already pending for the same hash
            # and same user — keeps confirm() URLs stable on retries.
            for existing in self._suggestions.values():
                if (
                    existing["user_id"] == user_id
                    and existing["hash"] == idem_hash
                    and existing["status"] == "pending"
                    and (self._clock() - existing["created_at"]) < SUGGESTION_TTL_SECONDS
                ):
                    return self._to_public(existing)
            record = {
                "suggestion_id": f"vasug-{uuid4().hex[:12]}",
                "user_id": user_id,
                "hash": idem_hash,
                "status": "pending",
                "created_at": self._clock(),
                "action_id": cleaned["action_id"],
                "action_type": cleaned["action_type"],
                "label": cleaned["label"],
                "risk_level": cleaned["risk_level"],
                "requires_confirmation": cleaned["requires_confirmation"],
                "parameters": cleaned["parameters"],
                "rationale": cleaned["rationale"],
            }
            self._suggestions[record["suggestion_id"]] = record
            self._metrics["suggested"] += 1
            return self._to_public(record)

    def confirm(self, *, user_id: str, suggestion_id: str, method: str = "click") -> Dict[str, Any]:
        method_norm = method if method in {"click", "voice"} else "click"
        with self._lock:
            record = self._suggestions.get(suggestion_id)
            if record is None:
                raise VoiceAgentActionError("suggestion not found", status_code=404)
            if record["user_id"] != user_id:
                raise VoiceAgentActionError("suggestion not owned", status_code=403)
            if (self._clock() - record["created_at"]) >= SUGGESTION_TTL_SECONDS:
                record["status"] = "expired"
                raise VoiceAgentActionError("suggestion expired", status_code=410)
            if record["status"] in {"executed", "denied", "failed"}:
                raise VoiceAgentActionError(
                    f"suggestion already {record['status']}", status_code=409
                )
            record["status"] = "confirmed"
            record["confirmation_method"] = method_norm
            self._metrics["confirmed"] += 1
            return self._to_public(record)

    def execute(
        self,
        *,
        user_id: str,
        user_role: str,
        suggestion_id: str,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            record = self._suggestions.get(suggestion_id)
            if record is None:
                raise VoiceAgentActionError("suggestion not found", status_code=404)
            if record["user_id"] != user_id:
                raise VoiceAgentActionError("suggestion not owned", status_code=403)
            if (self._clock() - record["created_at"]) >= SUGGESTION_TTL_SECONDS:
                record["status"] = "expired"
                raise VoiceAgentActionError("suggestion expired", status_code=410)
            if record["requires_confirmation"] and record["status"] != "confirmed":
                raise VoiceAgentActionError("suggestion not confirmed", status_code=409)
            # Idempotent replay: if the same hash already executed, return that.
            prior = self._completed_by_hash.get(record["hash"])
            if prior is not None:
                return prior
            record["status"] = "executing"
            action_type = record["action_type"]
            parameters = dict(record["parameters"])

        if action_type not in ACTION_TYPES:
            self._finalize(record, status="denied", message="action_type not allowed")
            raise VoiceAgentActionError("action_type not allowed", status_code=403)

        if not self._authorize(user_role, action_type):
            self._finalize(record, status="denied", message="role not authorized")
            raise VoiceAgentActionError("role not authorized", status_code=403)

        handler = self._dispatch.get(action_type)
        if handler is None:
            self._finalize(record, status="failed", message="no handler")
            raise VoiceAgentActionError("no handler for action", status_code=500)

        try:
            output = handler(user_id, parameters, record)
        except VoiceAgentActionError:
            self._finalize(record, status="failed", message="handler error")
            raise
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Voice-agent action execution failed")
            self._finalize(record, status="failed", message=str(exc))
            raise VoiceAgentActionError("execution failed", status_code=500) from exc

        result = self._finalize(
            record,
            status="success",
            message=output.get("message") or "ok",
            output=output,
            idempotency_key=idempotency_key,
        )
        with self._lock:
            self._completed_by_hash[record["hash"]] = result
        return result

    # -- Internal helpers ---------------------------------------------------

    def _to_public(self, record: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "suggestion_id": record["suggestion_id"],
            "action_id": record["action_id"],
            "action_type": record["action_type"],
            "label": record["label"],
            "risk_level": record["risk_level"],
            "requires_confirmation": record["requires_confirmation"],
            "parameters": dict(record["parameters"]),
            "rationale": record.get("rationale", ""),
            "status": record["status"],
        }

    def _finalize(
        self,
        record: Dict[str, Any],
        *,
        status: str,
        message: str,
        output: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            record["status"] = status
            record["finalized_at"] = self._clock()
            audit_entry = {
                "suggestion_id": record["suggestion_id"],
                "user_id": record["user_id"],
                "action_type": record["action_type"],
                "status": status,
                "message": message,
                "hash": record["hash"],
                "idempotency_key": idempotency_key,
                "risk_level": record["risk_level"],
                "confirmation_method": record.get("confirmation_method"),
            }
            self._audit.append(audit_entry)
            if status == "success":
                self._metrics["executed_success"] += 1
            elif status == "denied":
                self._metrics["executed_denied"] += 1
            else:
                self._metrics["executed_failed"] += 1
            return {
                "suggestion_id": record["suggestion_id"],
                "action_id": record["action_id"],
                "action_type": record["action_type"],
                "status": status,
                "message": message,
                "output": output or {},
                "risk_level": record["risk_level"],
            }

    def _authorize(self, role: str, action_type: str) -> bool:
        if role in {"admin"}:
            return True
        # All mutating actions in the first release require teacher or therapist.
        if action_type == "open_student_profile":
            return role in {"teacher", "therapist", "admin"}
        return role in {"teacher", "therapist"}

    # -- Per-action dispatch -----------------------------------------------

    def _payload_with_actor(self, user_id: str, parameters: Mapping[str, Any]) -> Dict[str, Any]:
        payload = dict(parameters)
        payload.setdefault("actor_id", user_id)
        return payload

    def _do_approve_plan(
        self, user_id: str, parameters: Dict[str, Any], record: Dict[str, Any]
    ) -> Dict[str, Any]:
        plan_id = str(parameters.get("plan_id") or "").strip()
        if not plan_id:
            raise VoiceAgentActionError("plan_id required", status_code=400)
        return self.learning_api.approve_plan(plan_id, self._payload_with_actor(user_id, parameters))

    def _do_reject_plan(
        self, user_id: str, parameters: Dict[str, Any], record: Dict[str, Any]
    ) -> Dict[str, Any]:
        plan_id = str(parameters.get("plan_id") or "").strip()
        if not plan_id:
            raise VoiceAgentActionError("plan_id required", status_code=400)
        return self.learning_api.reject_plan(plan_id, self._payload_with_actor(user_id, parameters))

    def _do_edit_approve_plan(
        self, user_id: str, parameters: Dict[str, Any], record: Dict[str, Any]
    ) -> Dict[str, Any]:
        plan_id = str(parameters.get("plan_id") or "").strip()
        if not plan_id:
            raise VoiceAgentActionError("plan_id required", status_code=400)
        return self.learning_api.edit_and_approve_plan(
            plan_id, self._payload_with_actor(user_id, parameters)
        )

    def _do_submit_intent(
        self, user_id: str, parameters: Dict[str, Any], record: Dict[str, Any]
    ) -> Dict[str, Any]:
        prompt = str(parameters.get("prompt") or "").strip()
        if not prompt:
            raise VoiceAgentActionError("prompt required", status_code=400)
        return self.learning_api.submit_intent(self._payload_with_actor(user_id, parameters))

    def _do_open_student_profile(
        self, user_id: str, parameters: Dict[str, Any], record: Dict[str, Any]
    ) -> Dict[str, Any]:
        # Non-mutating: just returns a navigation hint the frontend honours.
        student_id = str(parameters.get("student_id") or "").strip()
        if not student_id:
            raise VoiceAgentActionError("student_id required", status_code=400)
        return {
            "navigation": {"kind": "student_profile", "student_id": student_id},
            "message": f"Opening profile for {student_id}.",
        }
