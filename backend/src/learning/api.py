"""HTTP surface for the Pathfinder Learn bounded context.

Stateless adapter (mirrors ``insights_service`` / ``insights_copilot_planner``
patterns): the module owns a process-local in-memory repository and item bank
for the pilot demo, and exposes pure functions that the Flask app composes via
flat ``@app.route`` declarations. All persistence is delegated to
``LearningRepository``; planner work is bounded by
``DEFAULT_TOOL_CALL_BUDGET`` / ``DEFAULT_WALL_CLOCK_BUDGET_SECONDS`` carried on
``PlannerRequest``.

Tenant/actor IDs are accepted from the request body with pilot-demo defaults;
when wired into Azure the API CA already enforces tenant scope at the storage
layer via row-level security (`assert_learning_rls_contract_active`).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple
from uuid import uuid4

from flask import Flask, jsonify, request

from src.learning.diagnostic import (
    DeterministicItemSelector,
    DiagnosticItemBank,
    heatmap_status,
    load_item_bank,
    normalize_answer,
)
from src.learning.mastery import BetaBKT, MasteryEstimator, MasteryUpdateInput
from src.learning.models import (
    DiagnosticItem,
    InterventionPlan,
    MasteryEstimate,
    MasteryEvent,
    Provenance,
    StudentResponse,
)
from src.learning.planner import PlannerRequest, StubLearningPlanner
from src.learning.repository import InMemoryLearningRepository, LearningRepository
from src.learning.validator import PlanValidator, catalogue_grounding_rule
from src.learning.xapi import (
    ApprovalEvent,
    DiagnosticCompletionEvent,
    approval_event_to_xapi,
    diagnostic_completion_event_to_xapi,
    mastery_event_to_xapi,
)


PILOT_TENANT_ID = "tenant-phase-2"
PILOT_CLASS_ID = "class-jss2-a"
PILOT_STUDENT_ID = "pilot-jss2-student-001"
PILOT_TEACHER_ID = "pilot-jss2-teacher-001"
PILOT_DIAGNOSTIC_ITEMS_PER_RUN = 12
ITEM_BANK_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "learning" / "jss2_maths_diagnostic_phase_2.json"
)


class _SessionState:
    """Per-session diagnostic transcript held in memory for the pilot demo."""

    __slots__ = (
        "session_id",
        "tenant_id",
        "class_id",
        "student_id",
        "teacher_id",
        "diagnostic_id",
        "selected_items",
        "current_index",
        "estimates",
        "responses",
        "completed",
    )

    def __init__(
        self,
        session_id: str,
        tenant_id: str,
        class_id: str,
        student_id: str,
        teacher_id: str,
        diagnostic_id: str,
        selected_items: List[DiagnosticItem],
    ) -> None:
        self.session_id = session_id
        self.tenant_id = tenant_id
        self.class_id = class_id
        self.student_id = student_id
        self.teacher_id = teacher_id
        self.diagnostic_id = diagnostic_id
        self.selected_items = selected_items
        self.current_index = 0
        self.estimates: Dict[str, MasteryEstimate] = {}
        self.responses: List[StudentResponse] = []
        self.completed = False


class LearningApi:
    """Stateless façade with module-local state, mirroring ``InsightsService``."""

    def __init__(
        self,
        repository: Optional[LearningRepository] = None,
        item_bank: Optional[DiagnosticItemBank] = None,
        estimator: Optional[MasteryEstimator] = None,
    ) -> None:
        self.repository: LearningRepository = repository or InMemoryLearningRepository()
        self.item_bank: DiagnosticItemBank = item_bank or load_item_bank(ITEM_BANK_PATH)
        self.estimator: MasteryEstimator = estimator or BetaBKT()
        self.selector = DeterministicItemSelector()
        self._sessions: Dict[str, _SessionState] = {}
        self._student_estimates: Dict[Tuple[str, str], Dict[str, MasteryEstimate]] = {}
        self._pending_plans: Dict[str, Dict[str, Any]] = {}
        self._audit_events: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._allowed_skill_ids = [skill.skill_id for skill in self.item_bank.skills]
        self._validator: PlanValidator[InterventionPlan] = PlanValidator(
            [catalogue_grounding_rule(self._allowed_skill_ids)]
        )

    # ------------------------------------------------------------------
    # Diagnostic flow
    # ------------------------------------------------------------------
    def start_diagnostic(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or PILOT_CLASS_ID)
        student_id = str(payload.get("student_id") or PILOT_STUDENT_ID)
        teacher_id = str(payload.get("teacher_id") or PILOT_TEACHER_ID)
        target_skill_id = payload.get("skill_id")
        item_count = int(payload.get("item_count") or PILOT_DIAGNOSTIC_ITEMS_PER_RUN)

        prior = self._student_estimates.get((tenant_id, student_id), {})
        selected = self.selector.select_items(self.item_bank, prior_mastery=prior, limit=item_count)
        if target_skill_id:
            filtered = [item for item in selected if item.skill_id == target_skill_id]
            if filtered:
                selected = filtered

        session_id = f"diagnostic-session-{uuid4().hex[:12]}"
        state = _SessionState(
            session_id=session_id,
            tenant_id=tenant_id,
            class_id=class_id,
            student_id=student_id,
            teacher_id=teacher_id,
            diagnostic_id=self.item_bank.diagnostic_id,
            selected_items=selected,
        )
        with self._lock:
            self._sessions[session_id] = state
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=student_id,
            label=f"Started diagnostic {self.item_bank.diagnostic_id}",
            kind="diagnostic_started",
        )
        return {
            "session_id": session_id,
            "diagnostic_id": self.item_bank.diagnostic_id,
            "lang": self.item_bank.lang,
            "item": _item_to_payload(selected[0]) if selected else None,
            "items_remaining": max(0, len(selected) - 1),
            "items_total": len(selected),
        }

    def answer_diagnostic(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        session_id = str(payload.get("session_id") or "").strip()
        item_id = str(payload.get("item_id") or "").strip()
        response_text = str(payload.get("response_text") or "").strip()
        if not session_id or not item_id or not response_text:
            raise LearningApiError(
                "session_id, item_id, and response_text are required", status_code=400
            )
        state = self._sessions.get(session_id)
        if state is None:
            raise LearningApiError("unknown diagnostic session", status_code=404)
        if state.completed:
            raise LearningApiError("diagnostic session already completed", status_code=409)

        current_item = state.selected_items[state.current_index]
        if current_item.item_id != item_id:
            raise LearningApiError(
                f"expected item {current_item.item_id} but received {item_id}",
                status_code=409,
            )

        correct = normalize_answer(response_text) == normalize_answer(current_item.correct_answer or "")
        response = StudentResponse(
            tenant_id=state.tenant_id,
            student_id=state.student_id,
            item_id=current_item.item_id,
            skill_id=current_item.skill_id,
            response_text=response_text,
            correct=correct,
            lang=current_item.lang,
            provenance=current_item.provenance,
        )
        self.repository.save_student_response(
            response, idempotency_key=f"{state.session_id}:{current_item.item_id}"
        )
        state.responses.append(response)

        update = self.estimator.update(
            MasteryUpdateInput(
                tenant_id=state.tenant_id,
                student_id=state.student_id,
                skill_id=current_item.skill_id,
                correct=correct,
                prior_estimate=state.estimates.get(current_item.skill_id),
                item_difficulty=current_item.difficulty,
                lang=current_item.lang,
                provenance=current_item.provenance,
            )
        )
        state.estimates[current_item.skill_id] = update.estimate
        self._student_estimates.setdefault((state.tenant_id, state.student_id), {})[
            current_item.skill_id
        ] = update.estimate

        mastery_event = MasteryEvent(
            tenant_id=state.tenant_id,
            student_id=state.student_id,
            skill_id=current_item.skill_id,
            response_id=response.response_id,
            estimate=update.estimate,
            lang=update.lang,
            provenance=update.provenance,
        )
        statement = mastery_event_to_xapi(mastery_event)
        self.repository.save_mastery_event(mastery_event, statement)
        self.repository.emit_xapi_statement(
            state.tenant_id, state.student_id, statement, "ralph_queued"
        )

        state.current_index += 1
        next_item_payload: Optional[Dict[str, Any]] = None
        pending_plan_payload: Optional[Dict[str, Any]] = None
        completion_payload: Optional[Dict[str, Any]] = None
        if state.current_index >= len(state.selected_items):
            state.completed = True
            completion_event = DiagnosticCompletionEvent(
                tenant_id=state.tenant_id,
                student_id=state.student_id,
                diagnostic_id=state.diagnostic_id,
                item_count=len(state.selected_items),
                lang=self.item_bank.lang,
                provenance=self.item_bank.provenance,
            )
            completion_statement = diagnostic_completion_event_to_xapi(completion_event)
            self.repository.emit_xapi_statement(
                state.tenant_id, state.student_id, completion_statement, "ralph_queued"
            )
            completion_payload = completion_statement.model_dump()
            pending_plan_payload = self._build_and_persist_pending_plan(state)
        else:
            next_item_payload = _item_to_payload(state.selected_items[state.current_index])

        self._record_audit(
            tenant_id=state.tenant_id,
            actor_id=state.student_id,
            label=("Answered " + current_item.item_id + (" — correct" if correct else " — incorrect")),
            kind="diagnostic_answer",
        )

        return {
            "session_id": state.session_id,
            "item_id": current_item.item_id,
            "correct": correct,
            "expected_answer": current_item.correct_answer,
            "mastery_estimate": update.estimate.model_dump(),
            "next_item": next_item_payload,
            "items_remaining": max(0, len(state.selected_items) - state.current_index),
            "completed": state.completed,
            "pending_plan": pending_plan_payload,
            "completion_xapi": completion_payload,
        }

    # ------------------------------------------------------------------
    # Teacher surfaces
    # ------------------------------------------------------------------
    def get_class_mastery(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or PILOT_CLASS_ID)
        cells: List[Dict[str, Any]] = []
        for (event_tenant, student_id), estimates_by_skill in self._student_estimates.items():
            if event_tenant != tenant_id:
                continue
            for skill in self.item_bank.skills:
                estimate = estimates_by_skill.get(skill.skill_id)
                if estimate is None:
                    continue
                cells.append(
                    {
                        "student_id": student_id,
                        "skill_id": skill.skill_id,
                        "skill_label": skill.name,
                        "probability": estimate.probability,
                        "uncertainty": estimate.uncertainty,
                        "status": heatmap_status(estimate),
                    }
                )
        return {
            "tenant_id": tenant_id,
            "class_id": class_id,
            "diagnostic_id": self.item_bank.diagnostic_id,
            "cells": cells,
            "source": "live_in_memory" if cells else "no_responses_yet",
        }

    def list_pending_approvals(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        plans = [
            record
            for record in self._pending_plans.values()
            if record["tenant_id"] == tenant_id and record["status"] == "pending"
        ]
        return {"plans": plans, "count": len(plans)}

    def approve_plan(self, plan_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_plan(plan_id, payload, action="approved")

    def reject_plan(self, plan_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_plan(plan_id, payload, action="rejected")

    def submit_intent(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)
        role = str(payload.get("role") or "teacher")
        prompt_text = str(payload.get("prompt") or "").strip()
        if not prompt_text:
            raise LearningApiError("prompt is required", status_code=400)

        request_model = PlannerRequest(
            tenant_id=tenant_id,
            actor_id=actor_id,
            role=role,
            prompt=prompt_text,
            scope={
                "skill_ids": self._allowed_skill_ids,
                "student_ids": list(
                    sorted({sid for (_, sid) in self._student_estimates.keys() if _ == tenant_id})
                )
                or [PILOT_STUDENT_ID],
            },
            offline=True,
            lang=self.item_bank.lang,
            provenance=self.item_bank.provenance,
        )
        result = StubLearningPlanner().run_turn(request_model)
        validation = self._validator.validate(result.plan)
        if not validation.ok:
            raise LearningApiError(
                validation.audit_reason or "intent_plan_validation_failed",
                status_code=422,
            )
        record = self.repository.save_intervention_plan(
            result.plan, tenant_id=tenant_id, actor_id=actor_id, status="pending"
        )
        self._pending_plans[result.plan.plan_id] = record
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Intent submitted: {prompt_text[:80]}",
            kind="intent_submitted",
        )
        return {
            "plan": result.plan.model_dump(),
            "queued": result.queued,
            "offline_fallback": result.offline_fallback,
            "validated": True,
        }

    def list_audit(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        events = [event for event in self._audit_events if event["tenant_id"] == tenant_id]
        return {"events": events[-50:]}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _build_and_persist_pending_plan(self, state: _SessionState) -> Dict[str, Any]:
        request_model = PlannerRequest(
            tenant_id=state.tenant_id,
            actor_id=state.teacher_id,
            role="teacher",
            prompt="Suggest intervention groups for the completed JSS2 diagnostic session.",
            scope={
                "skill_ids": list(state.estimates.keys()) or self._allowed_skill_ids,
                "student_ids": [state.student_id],
            },
            offline=True,
            lang=self.item_bank.lang,
            provenance=self.item_bank.provenance,
        )
        result = StubLearningPlanner().run_turn(request_model)
        validation = self._validator.validate(result.plan)
        if not validation.ok:
            raise LearningApiError(
                validation.audit_reason or "diagnostic_plan_validation_failed",
                status_code=500,
            )
        record = self.repository.save_intervention_plan(
            result.plan, tenant_id=state.tenant_id, actor_id=state.teacher_id, status="pending"
        )
        self._pending_plans[result.plan.plan_id] = record
        return record

    def _decide_plan(
        self, plan_id: str, payload: Mapping[str, Any], *, action: str
    ) -> Dict[str, Any]:
        record = self._pending_plans.get(plan_id)
        if record is None:
            raise LearningApiError(f"plan {plan_id} not found", status_code=404)
        if record["status"] != "pending":
            raise LearningApiError(
                f"plan {plan_id} is already {record['status']}", status_code=409
            )
        tenant_id = str(payload.get("tenant_id") or record["tenant_id"])
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)
        reason = payload.get("reason")
        event = ApprovalEvent(
            tenant_id=tenant_id,
            actor_id=actor_id,
            plan_id=plan_id,
            action=action,
            reason=str(reason) if reason else None,
            lang=record["lang"],
            provenance=[Provenance.model_validate(item) for item in record["provenance"]],
        )
        statement = approval_event_to_xapi(event)
        self.repository.record_approval(event, statement)
        self.repository.emit_xapi_statement(tenant_id, actor_id, statement, "ralph_queued")
        record["status"] = action
        record["decided_by"] = actor_id
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"{action.title()} plan {plan_id}",
            kind=f"plan_{action}",
        )
        return {
            "ok": True,
            "plan_id": plan_id,
            "action": action,
            "xapi_id": statement.id,
            "xapi_statement": statement.model_dump(),
            "audit": self._audit_events[-1],
        }

    def _record_audit(self, *, tenant_id: str, actor_id: str, label: str, kind: str) -> None:
        self._audit_events.append(
            {
                "tenant_id": tenant_id,
                "actor_id": actor_id,
                "label": label,
                "kind": kind,
            }
        )

    # ------------------------------------------------------------------
    # Test helpers
    # ------------------------------------------------------------------
    def _reset_for_tests(self) -> None:
        with self._lock:
            self._sessions.clear()
            self._student_estimates.clear()
            self._pending_plans.clear()
            self._audit_events.clear()


class LearningApiError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _item_to_payload(item: DiagnosticItem) -> Dict[str, Any]:
    return {
        "item_id": item.item_id,
        "skill_id": item.skill_id,
        "prompt": item.prompt,
        "item_type": item.item_type,
        "difficulty": item.difficulty,
        "lang": item.lang,
    }


def _read_payload() -> Dict[str, Any]:
    if request.method == "GET":
        return {k: v for k, v in request.args.items()}
    if not request.data:
        return {}
    try:
        payload = json.loads(request.get_data(as_text=True))
    except json.JSONDecodeError as exc:
        raise LearningApiError(f"invalid json payload: {exc}", status_code=400) from exc
    if not isinstance(payload, dict):
        raise LearningApiError("json payload must be an object", status_code=400)
    return payload


def register_learning_api(app: Flask, api: Optional[LearningApi] = None) -> LearningApi:
    """Register `/api/learning/*` routes on the given Flask app and return the API singleton."""

    learning_api = api or LearningApi()

    def _wrap(handler):
        def view(*args, **kwargs):
            try:
                payload = _read_payload()
                result = handler(*args, payload=payload, **kwargs)
                return jsonify(result)
            except LearningApiError as exc:
                return jsonify({"error": str(exc)}), exc.status_code

        view.__name__ = handler.__name__
        return view

    @app.route("/api/learning/diagnostic/start", methods=["POST"])
    @_wrap
    def _start_diagnostic(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.start_diagnostic(payload)

    @app.route("/api/learning/diagnostic/answer", methods=["POST"])
    @_wrap
    def _answer_diagnostic(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.answer_diagnostic(payload)

    @app.route("/api/learning/class/mastery", methods=["GET"])
    @_wrap
    def _class_mastery(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_class_mastery(payload)

    @app.route("/api/learning/approvals/pending", methods=["GET"])
    @_wrap
    def _pending_approvals(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_pending_approvals(payload)

    @app.route("/api/learning/approvals/<plan_id>/approve", methods=["POST"])
    @_wrap
    def _approve_plan(plan_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.approve_plan(plan_id, payload)

    @app.route("/api/learning/approvals/<plan_id>/reject", methods=["POST"])
    @_wrap
    def _reject_plan(plan_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.reject_plan(plan_id, payload)

    @app.route("/api/learning/intent", methods=["POST"])
    @_wrap
    def _intent(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.submit_intent(payload)

    @app.route("/api/learning/audit", methods=["GET"])
    @_wrap
    def _audit(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_audit(payload)

    return learning_api


__all__ = [
    "LearningApi",
    "LearningApiError",
    "register_learning_api",
    "PILOT_TENANT_ID",
    "PILOT_CLASS_ID",
    "PILOT_STUDENT_ID",
    "PILOT_TEACHER_ID",
]
