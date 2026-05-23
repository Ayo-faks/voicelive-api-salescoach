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
import os
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
    load_subject_diagnostics,
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
from src.learning.operations import compute_kpi_report, load_metric_snapshots
from src.learning.planner import PlannerRequest, StubLearningPlanner
from src.learning.repository import InMemoryLearningRepository, LearningRepository
from src.learning.validator import PlanValidator, catalogue_grounding_rule
from src.learning.voice import FlaskSockVoiceTransportAdapter, VoiceFrame
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
PILOT_KPI_TENANT_ID = "tenant-phase-4"
VOICE_FEATURE_FLAG_ENV = "PATHFINDER_VOICE_ENABLED"
ITEM_BANK_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "learning" / "jss2_maths_diagnostic_phase_2.json"
)
DIAGNOSTICS_DIR = (
    Path(__file__).resolve().parents[3] / "data" / "learning" / "diagnostics"
)
PILOT_METRICS_PATH = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "learning"
    / "ops"
    / "phase_4_pilot_metrics.json"
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
        "bank",
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
        bank: DiagnosticItemBank,
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
        self.bank = bank


class LearningApi:
    """Stateless façade with module-local state, mirroring ``InsightsService``."""

    def __init__(
        self,
        repository: Optional[LearningRepository] = None,
        item_bank: Optional[DiagnosticItemBank] = None,
        estimator: Optional[MasteryEstimator] = None,
        subject_banks: Optional[List[DiagnosticItemBank]] = None,
    ) -> None:
        self.repository: LearningRepository = repository or InMemoryLearningRepository()
        self.item_bank: DiagnosticItemBank = item_bank or load_item_bank(ITEM_BANK_PATH)
        self.estimator: MasteryEstimator = estimator or BetaBKT()
        self.selector = DeterministicItemSelector()
        self.voice_adapter = FlaskSockVoiceTransportAdapter()
        self._sessions: Dict[str, _SessionState] = {}
        self._student_estimates: Dict[Tuple[str, str], Dict[str, MasteryEstimate]] = {}
        self._pending_plans: Dict[str, Dict[str, Any]] = {}
        self._audit_events: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

        # Build a subject registry from the primary maths bank plus any extra
        # subject fixtures shipped under data/learning/diagnostics/. The maths
        # bank stays the default for back-compat (clients that omit subject /
        # diagnostic_id keep the existing behaviour).
        registry_banks: List[DiagnosticItemBank] = [self.item_bank]
        extra = subject_banks if subject_banks is not None else load_subject_diagnostics(DIAGNOSTICS_DIR)
        for bank in extra:
            if bank.diagnostic_id != self.item_bank.diagnostic_id:
                registry_banks.append(bank)
        self._banks_by_id: Dict[str, DiagnosticItemBank] = {
            bank.diagnostic_id: bank for bank in registry_banks
        }
        self._banks_by_subject: Dict[str, DiagnosticItemBank] = {
            bank.subject: bank for bank in registry_banks if bank.subject
        }

        seen: Dict[str, None] = {}
        for bank in registry_banks:
            for skill in bank.skills:
                seen.setdefault(skill.skill_id, None)
        self._allowed_skill_ids = list(seen.keys())
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

        bank = self._resolve_bank(payload)
        prior = self._student_estimates.get((tenant_id, student_id), {})
        selected = self.selector.select_items(bank, prior_mastery=prior, limit=item_count)
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
            diagnostic_id=bank.diagnostic_id,
            selected_items=selected,
            bank=bank,
        )
        with self._lock:
            self._sessions[session_id] = state
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=student_id,
            label=f"Started diagnostic {bank.diagnostic_id}",
            kind="diagnostic_started",
        )
        return {
            "session_id": session_id,
            "diagnostic_id": bank.diagnostic_id,
            "subject": bank.subject,
            "lang": bank.lang,
            "item": _item_to_payload(selected[0]) if selected else None,
            "items_remaining": max(0, len(selected) - 1),
            "items_total": len(selected),
        }

    def _resolve_bank(self, payload: Mapping[str, Any]) -> DiagnosticItemBank:
        diagnostic_id = payload.get("diagnostic_id")
        if diagnostic_id:
            bank = self._banks_by_id.get(str(diagnostic_id))
            if bank is None:
                raise LearningApiError(
                    f"unknown diagnostic_id {diagnostic_id!r}", status_code=404
                )
            return bank
        subject = payload.get("subject")
        if subject:
            bank = self._banks_by_subject.get(str(subject))
            if bank is None:
                raise LearningApiError(f"unknown subject {subject!r}", status_code=404)
            return bank
        return self.item_bank

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
                lang=state.bank.lang,
                provenance=state.bank.provenance,
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
        skill_labels: Dict[str, str] = {}
        for bank in self._banks_by_id.values():
            for skill in bank.skills:
                skill_labels.setdefault(skill.skill_id, skill.name)
        cells: List[Dict[str, Any]] = []
        for (event_tenant, student_id), estimates_by_skill in self._student_estimates.items():
            if event_tenant != tenant_id:
                continue
            for skill_id, estimate in estimates_by_skill.items():
                if skill_id not in skill_labels:
                    continue
                cells.append(
                    {
                        "student_id": student_id,
                        "skill_id": skill_id,
                        "skill_label": skill_labels[skill_id],
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

    def get_pilot_kpis(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_KPI_TENANT_ID)
        snapshots = load_metric_snapshots(PILOT_METRICS_PATH, tenant_id)
        if not snapshots:
            raise LearningApiError(
                f"no pilot metric snapshots for tenant {tenant_id}", status_code=404
            )
        report = compute_kpi_report(snapshots, tenant_id)
        cards = [
            {
                "label": "Diagnostic completion",
                "value": f"{report.diagnostic_completion_rate * 100:.1f}%",
                "detail": (
                    f"{sum(item.completed_diagnostics for item in snapshots)} of "
                    f"{sum(item.assigned_diagnostics for item in snapshots)} assigned diagnostics"
                ),
            },
            {
                "label": "Approved interventions",
                "value": f"{report.approved_intervention_rate * 100:.0f}%",
                "detail": (
                    f"{sum(item.suggestions_approved for item in snapshots)} of "
                    f"{sum(item.suggestions_created for item in snapshots)} suggestions approved"
                ),
            },
            {
                "label": "Provenance coverage",
                "value": f"{report.provenance_coverage * 100:.1f}%",
                "detail": "Every suggestion has source evidence"
                if report.provenance_coverage >= 1.0
                else "Suggestions missing source evidence",
            },
            {
                "label": "Safety pass rate",
                "value": f"{report.safety_rate * 100:.1f}%",
                "detail": (
                    f"{sum(item.safety_eval_passed for item in snapshots)} of "
                    f"{sum(item.safety_eval_cases for item in snapshots)} eval cases passed"
                ),
            },
            {
                "label": "DSR SLA",
                "value": f"{report.dsr_turnaround_rate * 100:.0f}%",
                "detail": (
                    f"{sum(item.dsr_within_sla for item in snapshots)} of "
                    f"{sum(item.dsr_requests for item in snapshots)} requests within SLA"
                ),
            },
            {
                "label": "Weekly cost per student",
                "value": f"GBP {report.cost_per_student_gbp:.2f}",
                "detail": f"{max(item.active_students for item in snapshots)} active students",
            },
        ]
        return {
            "source": "fixture",
            "tenant_id": report.tenant_id,
            "week_count": report.week_count,
            "meets_pilot_thresholds": report.meets_pilot_thresholds,
            "report": report.model_dump(),
            "cards": cards,
            "lang": report.lang,
            "provenance": [item.model_dump() for item in report.provenance],
        }

    # ------------------------------------------------------------------
    # Subjects (multi-subject diagnostic registry)
    # ------------------------------------------------------------------
    def list_subjects(self, _payload: Mapping[str, Any]) -> Dict[str, Any]:
        subjects: List[Dict[str, Any]] = []
        for bank in self._banks_by_id.values():
            subjects.append(
                {
                    "diagnostic_id": bank.diagnostic_id,
                    "subject": bank.subject,
                    "title": bank.title,
                    "lang": bank.lang,
                    "skill_count": len(bank.skills),
                    "item_count": len(bank.items),
                    "skills": [
                        {"skill_id": s.skill_id, "name": s.name} for s in bank.skills
                    ],
                    "provenance": [p.model_dump() for p in bank.provenance],
                }
            )
        return {"subjects": subjects, "count": len(subjects)}

    # ------------------------------------------------------------------
    # Voice (F3) — feature-flagged, offline-fallback path
    # ------------------------------------------------------------------
    @staticmethod
    def voice_enabled() -> bool:
        raw = os.environ.get(VOICE_FEATURE_FLAG_ENV, "")
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    def get_voice_config(self, _payload: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "enabled": self.voice_enabled(),
            "transport": "flask-sock",
            "offline_fallback": self.voice_adapter.offline_fallback,
        }

    def submit_voice_frame(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        if not self.voice_enabled():
            raise LearningApiError("voice feature disabled", status_code=403)
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        actor_id = str(payload.get("actor_id") or PILOT_STUDENT_ID)
        mode = str(payload.get("mode") or "text")
        body = payload.get("payload")
        if not isinstance(body, str) or not body.strip():
            raise LearningApiError("payload is required (text)", status_code=400)
        lang = str(payload.get("lang") or "en-NG")
        try:
            frame = VoiceFrame(
                tenant_id=tenant_id,
                actor_id=actor_id,
                mode=mode,
                payload=body,
                lang=lang,
                provenance=[
                    Provenance(
                        source="LearningApi.submit_voice_frame",
                        rule_id="phase_3_voice_entrypoint",
                        confidence=1.0,
                        evidence_count=1,
                    )
                ],
            )
        except Exception as exc:  # pydantic validation surfaces as 400
            raise LearningApiError(f"invalid voice frame: {exc}", status_code=400) from exc
        result = self.voice_adapter.handle_offline_frame(frame, repository=self.repository)
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Queued voice frame ({mode})",
            kind="voice_frame_queued",
        )
        return result.model_dump()

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

    @app.route("/api/learning/kpis", methods=["GET"])
    @_wrap
    def _kpis(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_pilot_kpis(payload)

    @app.route("/api/learning/voice/config", methods=["GET"])
    @_wrap
    def _voice_config(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_voice_config(payload)

    @app.route("/api/learning/voice/frame", methods=["POST"])
    @_wrap
    def _voice_frame(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.submit_voice_frame(payload)

    @app.route("/api/learning/subjects", methods=["GET"])
    @_wrap
    def _subjects(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_subjects(payload)

    return learning_api


__all__ = [
    "LearningApi",
    "LearningApiError",
    "register_learning_api",
    "DIAGNOSTICS_DIR",
    "ITEM_BANK_PATH",
    "PILOT_TENANT_ID",
    "PILOT_CLASS_ID",
    "PILOT_STUDENT_ID",
    "PILOT_TEACHER_ID",
    "PILOT_KPI_TENANT_ID",
]
