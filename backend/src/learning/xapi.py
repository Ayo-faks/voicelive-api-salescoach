"""xAPI contracts and emitters for Pathfinder Learn events."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Mapping, Optional, Protocol, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request
from uuid import uuid4

from pydantic import Field

from src.learning.models import (
    ContractModel,
    LanguageAndProvenanceModel,
    MasteryEvent,
    OfflineQueuedEvent,
    Provenance,
)

logger = logging.getLogger(__name__)

XAPI_VERSION_HEADER = "1.0.3"
RALPH_STATEMENTS_PATH = "/xAPI/statements"


class XAPIStatement(ContractModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    actor: Dict[str, Any] = Field(min_length=1)
    verb: Dict[str, Any] = Field(min_length=1)
    object: Dict[str, Any] = Field(min_length=1)
    result: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class XAPIEmitter(Protocol):
    def emit(self, statement: XAPIStatement) -> XAPIStatement:
        raise NotImplementedError


class ApprovalEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"approval-{uuid4().hex[:12]}")
    event_type: Literal["approval"] = "approval"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    plan_id: str = Field(min_length=1)
    action: Literal["approved", "edited_approved", "rejected"]
    reason: Optional[str] = None


class StudentFactDecisionEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"student-fact-decision-{uuid4().hex[:12]}")
    event_type: Literal["student_fact_decision"] = "student_fact_decision"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    fact_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    action: Literal["approved", "edited_approved", "rejected"]
    reason: Optional[str] = None


class OverrideEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"override-{uuid4().hex[:12]}")
    event_type: Literal["override"] = "override"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class DiagnosticCompletionEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"diagnostic-completion-{uuid4().hex[:12]}")
    event_type: Literal["diagnostic_completion"] = "diagnostic_completion"
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    diagnostic_id: str = Field(min_length=1)
    item_count: int = Field(ge=1)


class StudentProfileViewEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"student-profile-view-{uuid4().hex[:12]}")
    event_type: Literal["student_profile_view"] = "student_profile_view"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_count: int = Field(ge=0)


class LTILaunchEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"lti-launch-{uuid4().hex[:12]}")
    event_type: Literal["lti_launch"] = "lti_launch"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    class_id: str = Field(min_length=1)
    role: Literal["teacher", "learner"]
    issuer: str = Field(min_length=1)
    deployment_id: str = Field(min_length=1)
    resource_link_id: str = Field(min_length=1)


class CareerPlanEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"career-plan-event-{uuid4().hex[:12]}")
    event_type: Literal["career_plan"] = "career_plan"
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    plan_id: str = Field(min_length=1)
    pathway_count: int = Field(ge=1)


def _actor(actor_id: str) -> Dict[str, Any]:
    return {"account": {"homePage": "https://pathfinder.learn", "name": actor_id}}


def _context(tenant_id: str, lang: str, provenance: List[Provenance]) -> Dict[str, Any]:
    return {
        "contextActivities": {"category": [{"id": "https://pathfinder.learn/xapi/context/learning"}]},
        "extensions": {
            "https://pathfinder.learn/extensions/tenant_id": tenant_id,
            "https://pathfinder.learn/extensions/lang": lang,
            "https://pathfinder.learn/extensions/provenance": [item.model_dump() for item in provenance],
        },
    }


def mastery_event_to_xapi(event: MasteryEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.student_id),
        verb={"id": "https://pathfinder.learn/xapi/verbs/updated-mastery", "display": {"en": "updated mastery"}},
        object={"id": f"https://pathfinder.learn/skills/{event.skill_id}", "definition": {"type": "Skill"}},
        result={
            "score": {"scaled": event.estimate.probability},
            "extensions": {
                "https://pathfinder.learn/extensions/mastery_kind": event.estimate.kind,
                "https://pathfinder.learn/extensions/uncertainty": event.estimate.uncertainty,
                "https://pathfinder.learn/extensions/response_id": event.response_id,
            },
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def approval_event_to_xapi(event: ApprovalEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={"id": f"https://pathfinder.learn/xapi/verbs/{event.action}", "display": {"en": event.action}},
        object={"id": f"https://pathfinder.learn/plans/{event.plan_id}", "definition": {"type": "InterventionPlan"}},
        result={"response": event.reason or event.action},
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def student_fact_decision_event_to_xapi(event: StudentFactDecisionEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={"id": f"https://pathfinder.learn/xapi/verbs/{event.action}-student-fact", "display": {"en": event.action}},
        object={
            "id": f"https://pathfinder.learn/students/{event.student_id}/facts/{event.fact_id}",
            "definition": {"type": "StudentFact"},
        },
        result={"response": event.reason or event.action},
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def override_event_to_xapi(event: OverrideEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={"id": "https://pathfinder.learn/xapi/verbs/overrode-mastery", "display": {"en": "overrode mastery"}},
        object={"id": f"https://pathfinder.learn/students/{event.student_id}/skills/{event.skill_id}"},
        result={"response": event.reason},
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def diagnostic_completion_event_to_xapi(event: DiagnosticCompletionEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.student_id),
        verb={"id": "http://adlnet.gov/expapi/verbs/completed", "display": {"en": "completed"}},
        object={
            "id": f"https://pathfinder.learn/diagnostics/{event.diagnostic_id}",
            "definition": {"type": "Diagnostic"},
        },
        result={"extensions": {"https://pathfinder.learn/extensions/item_count": event.item_count}},
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def student_profile_view_event_to_xapi(event: StudentProfileViewEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={
            "id": "https://pathfinder.learn/xapi/verbs/viewed-profile",
            "display": {"en": "viewed profile"},
        },
        object={
            "id": f"https://pathfinder.learn/students/{event.student_id}",
            "definition": {"type": "Student"},
        },
        result={
            "extensions": {
                "https://pathfinder.learn/extensions/skill_count": event.skill_count,
            }
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def lti_launch_event_to_xapi(event: LTILaunchEvent) -> XAPIStatement:
    context = _context(event.tenant_id, event.lang, event.provenance)
    context.setdefault("extensions", {}).update(
        {
            "https://pathfinder.learn/extensions/class_id": event.class_id,
            "https://pathfinder.learn/extensions/role": event.role,
            "https://pathfinder.learn/extensions/lti_issuer": event.issuer,
            "https://pathfinder.learn/extensions/lti_deployment_id": event.deployment_id,
        }
    )
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={
            "id": "https://pathfinder.learn/xapi/verbs/launched-lti",
            "display": {"en": "launched LTI"},
        },
        object={
            "id": f"https://pathfinder.learn/lti/resource-links/{event.resource_link_id}",
            "definition": {"type": "LTIResourceLink"},
        },
        result={"extensions": {"https://pathfinder.learn/extensions/launch_role": event.role}},
        context=context,
    )


def career_plan_event_to_xapi(event: CareerPlanEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.actor_id),
        verb={
            "id": "https://pathfinder.learn/xapi/verbs/shortlisted-career-pathways",
            "display": {"en": "shortlisted career pathways"},
        },
        object={"id": f"https://pathfinder.learn/career-plans/{event.plan_id}", "definition": {"type": "CareerPlan"}},
        result={
            "extensions": {
                "https://pathfinder.learn/extensions/student_id": event.student_id,
                "https://pathfinder.learn/extensions/pathway_count": event.pathway_count,
            }
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


# ---------------------------------------------------------------------------
# W3-A: retry-after-explanation events (north-star metric, MVP §4.3)
# ---------------------------------------------------------------------------


class ExplanationViewedEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"explanation-viewed-{uuid4().hex[:12]}")
    event_type: Literal["explanation_viewed"] = "explanation_viewed"
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    question_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    explanation_id: str = Field(min_length=1)
    explanation_version: str = Field(min_length=1)


class QuestionRetriedEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"question-retried-{uuid4().hex[:12]}")
    event_type: Literal["question_retried"] = "question_retried"
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    question_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    explanation_version: str = Field(min_length=1)
    attempt_number: int = Field(ge=2)


class RetryOutcomeEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"retry-outcome-{uuid4().hex[:12]}")
    event_type: Literal["retry_outcome"] = "retry_outcome"
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    question_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    explanation_version: str = Field(min_length=1)
    succeeded: bool


def explanation_viewed_event_to_xapi(event: ExplanationViewedEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.student_id),
        verb={
            "id": "http://adlnet.gov/expapi/verbs/experienced",
            "display": {"en": "experienced"},
        },
        object={
            "id": f"https://pathfinder.learn/explanations/{event.explanation_id}",
            "definition": {"type": "Explanation"},
        },
        result={
            "extensions": {
                "https://pathfinder.learn/extensions/question_id": event.question_id,
                "https://pathfinder.learn/extensions/skill_id": event.skill_id,
                "https://pathfinder.learn/extensions/explanation_version": event.explanation_version,
            }
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def question_retried_event_to_xapi(event: QuestionRetriedEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.student_id),
        verb={
            "id": "https://pathfinder.learn/xapi/verbs/retried-question",
            "display": {"en": "retried question"},
        },
        object={
            "id": f"https://pathfinder.learn/questions/{event.question_id}",
            "definition": {"type": "Question"},
        },
        result={
            "extensions": {
                "https://pathfinder.learn/extensions/attempt_number": event.attempt_number,
                "https://pathfinder.learn/extensions/explanation_version": event.explanation_version,
                "https://pathfinder.learn/extensions/skill_id": event.skill_id,
            }
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


def retry_outcome_event_to_xapi(event: RetryOutcomeEvent) -> XAPIStatement:
    return XAPIStatement(
        id=event.event_id,
        actor=_actor(event.student_id),
        verb={
            "id": (
                "http://adlnet.gov/expapi/verbs/passed"
                if event.succeeded
                else "http://adlnet.gov/expapi/verbs/failed"
            ),
            "display": {"en": "passed" if event.succeeded else "failed"},
        },
        object={
            "id": f"https://pathfinder.learn/questions/{event.question_id}/retry",
            "definition": {"type": "QuestionRetry"},
        },
        result={
            "success": event.succeeded,
            "extensions": {
                "https://pathfinder.learn/extensions/explanation_version": event.explanation_version,
                "https://pathfinder.learn/extensions/skill_id": event.skill_id,
            },
        },
        context=_context(event.tenant_id, event.lang, event.provenance),
    )


class AuditLedgerXAPISink:
    """Offline-capable xAPI sink backed by the audit ledger when available."""

    def __init__(self, audit_ledger: Optional[Any] = None) -> None:
        self.audit_ledger = audit_ledger
        self.emitted: List[XAPIStatement] = []

    def emit(self, statement: XAPIStatement) -> XAPIStatement:
        validated = XAPIStatement.model_validate(statement.model_dump())
        self.emitted.append(validated)
        if self.audit_ledger is not None and hasattr(self.audit_ledger, "log_audit_event"):
            self.audit_ledger.log_audit_event(
                user_id=None,
                action="xapi.emit",
                resource_type="xapi_statement",
                resource_id=validated.id,
                metadata=validated.model_dump(),
            )
        return validated


class XAPITransport(Protocol):
    """HTTP transport boundary for Ralph LRS — kept narrow for easy mocking."""

    def post(self, url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> Tuple[int, bytes]:
        raise NotImplementedError


class UrllibXAPITransport:
    """Default stdlib HTTP transport; no third-party dependency."""

    def post(self, url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> Tuple[int, bytes]:
        req = urllib_request.Request(url, data=body, headers=dict(headers), method="POST")
        try:
            with urllib_request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — trusted Ralph endpoint
                return resp.status, resp.read()
        except urllib_error.HTTPError as exc:
            return exc.code, exc.read() if exc.fp is not None else b""
        except (urllib_error.URLError, TimeoutError, OSError) as exc:
            logger.warning("ralph_transport_unreachable: %s", exc)
            return 0, str(exc).encode("utf-8", errors="replace")


class InMemoryXAPITransport:
    """Test transport: deterministic responses and a recorded call log."""

    def __init__(self, responses: Optional[List[Tuple[int, bytes]]] = None, default: Tuple[int, bytes] = (200, b"")):
        self._responses = list(responses or [])
        self._default = default
        self.calls: List[Dict[str, Any]] = []

    def post(self, url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> Tuple[int, bytes]:
        self.calls.append({"url": url, "headers": dict(headers), "body": body, "timeout": timeout})
        if self._responses:
            return self._responses.pop(0)
        return self._default


class RalphXAPISink:
    """Ralph-compatible sink with buffering, retry, and offline-queue fallback.

    Statuses on a per-statement basis (also surfaced as :attr:`sink_status` for
    back-compat with the Phase 1 trace assertion):

    * ``ralph_synced`` — endpoint POST succeeded (2xx).
    * ``ralph_queued`` — no endpoint configured or :attr:`offline` is True; held
      in the internal buffer for later flush.
    * ``ralph_failed`` — endpoint POST attempted and failed; held in the buffer
      and (when a repository is wired) appended to ``learning_offline_queue``.
    """

    DEFAULT_TIMEOUT = 5.0

    def __init__(
        self,
        endpoint: Optional[str] = None,
        offline: bool = True,
        *,
        auth_token: Optional[str] = None,
        transport: Optional[XAPITransport] = None,
        repository: Optional[Any] = None,
        request_timeout: float = DEFAULT_TIMEOUT,
        max_buffer: int = 1000,
    ) -> None:
        self.endpoint = endpoint.rstrip("/") if endpoint else None
        self.offline = offline or self.endpoint is None
        self.auth_token = auth_token
        self.transport: XAPITransport = transport or UrllibXAPITransport()
        self.repository = repository
        self.request_timeout = request_timeout
        self.max_buffer = max_buffer
        self.emitted: List[XAPIStatement] = []
        self.statuses: List[Dict[str, Any]] = []
        self.sink_status = "ralph_queued" if self.offline else "ralph_synced"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def emit(self, statement: XAPIStatement) -> XAPIStatement:
        validated = XAPIStatement.model_validate(statement.model_dump())
        self.emitted.append(validated)
        status = self._deliver(validated)
        self._record_status(validated, status)
        self.sink_status = status
        return validated

    def flush(self) -> Dict[str, int]:
        """Retry buffered statements that are not yet ``ralph_synced``.

        Returns a small summary dict for observability.
        """
        summary = {"attempted": 0, "synced": 0, "failed": 0, "queued": 0}
        if self.offline or self.endpoint is None:
            summary["queued"] = sum(1 for s in self.statuses if s["status"] == "ralph_queued")
            return summary
        for record in self.statuses:
            if record["status"] == "ralph_synced":
                continue
            summary["attempted"] += 1
            new_status = self._deliver(record["statement"])
            record["status"] = new_status
            record["attempts"] = record.get("attempts", 0) + 1
            if new_status == "ralph_synced":
                summary["synced"] += 1
            elif new_status == "ralph_failed":
                summary["failed"] += 1
            else:
                summary["queued"] += 1
        if self.statuses:
            self.sink_status = self.statuses[-1]["status"]
        return summary

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _deliver(self, statement: XAPIStatement) -> str:
        if self.offline or self.endpoint is None:
            return "ralph_queued"
        url = f"{self.endpoint}{RALPH_STATEMENTS_PATH}"
        body = json.dumps(statement.model_dump()).encode("utf-8")
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "X-Experience-API-Version": XAPI_VERSION_HEADER,
        }
        if self.auth_token:
            token = self.auth_token
            if not token.startswith(("Basic ", "Bearer ")):
                token = f"Bearer {token}"
            headers["Authorization"] = token
        try:
            status_code, _body = self.transport.post(url, headers, body, self.request_timeout)
        except Exception as exc:  # transport contract should not raise; defensive
            logger.exception("ralph_transport_raised: %s", exc)
            self._queue_failed(statement)
            return "ralph_failed"
        if 200 <= status_code < 300:
            return "ralph_synced"
        logger.warning("ralph_post_non_2xx: status=%s", status_code)
        self._queue_failed(statement)
        return "ralph_failed"

    def _queue_failed(self, statement: XAPIStatement) -> None:
        if self.repository is None or not hasattr(self.repository, "queue_offline_event"):
            return
        context_ext = statement.context.get("extensions", {}) if isinstance(statement.context, Mapping) else {}
        tenant_id = context_ext.get("https://pathfinder.learn/extensions/tenant_id") or "unknown"
        actor_id = ""
        actor = statement.actor or {}
        if isinstance(actor, Mapping):
            account = actor.get("account") if isinstance(actor.get("account"), Mapping) else {}
            actor_id = str(account.get("name") or "") if account else ""
        try:
            self.repository.queue_offline_event(
                OfflineQueuedEvent(
                    tenant_id=str(tenant_id),
                    actor_id=actor_id or "xapi-emitter",
                    idempotency_key=f"xapi:{statement.id}",
                    event_type="xapi_statement.retry",
                    payload={"statement": statement.model_dump()},
                )
            )
        except Exception as exc:  # repo failure must not break emission path
            logger.exception("ralph_offline_queue_failed: %s", exc)

    def _record_status(self, statement: XAPIStatement, status: str) -> None:
        if len(self.statuses) >= self.max_buffer:
            # Drop the oldest already-synced record; otherwise drop the oldest entry
            for idx, rec in enumerate(self.statuses):
                if rec["status"] == "ralph_synced":
                    self.statuses.pop(idx)
                    break
            else:
                self.statuses.pop(0)
        self.statuses.append({"statement": statement, "status": status, "attempts": 1})


def build_ralph_sink_from_env(
    env: Optional[Mapping[str, str]] = None,
    *,
    repository: Optional[Any] = None,
    transport: Optional[XAPITransport] = None,
) -> RalphXAPISink:
    """Construct a sink from ``RALPH_BASE_URL`` / ``RALPH_AUTH_TOKEN``.

    Falls back to an offline-only sink when ``RALPH_BASE_URL`` is unset or
    blank, preserving the offline-first contract.
    """
    env = env if env is not None else os.environ
    endpoint = (env.get("RALPH_BASE_URL") or "").strip() or None
    token = (env.get("RALPH_AUTH_TOKEN") or "").strip() or None
    timeout_raw = (env.get("RALPH_TIMEOUT_SECONDS") or "").strip()
    try:
        timeout = float(timeout_raw) if timeout_raw else RalphXAPISink.DEFAULT_TIMEOUT
    except ValueError:
        timeout = RalphXAPISink.DEFAULT_TIMEOUT
    return RalphXAPISink(
        endpoint=endpoint,
        offline=endpoint is None,
        auth_token=token,
        transport=transport,
        repository=repository,
        request_timeout=timeout,
    )
