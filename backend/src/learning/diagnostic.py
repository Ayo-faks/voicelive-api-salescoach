"""Diagnostic and teacher-view contracts for Pathfinder Learn Phase 2."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Literal, Mapping, Optional, Protocol
from uuid import uuid4

from pydantic import Field

from src.learning.mastery import BetaBKT, MasteryEstimator, MasteryUpdateInput
from src.learning.models import (
    ContractModel,
    DiagnosticItem,
    InterventionPlan,
    LanguageAndProvenanceModel,
    MasteryEstimate,
    MasteryEvent,
    Provenance,
    Skill,
    StudentResponse,
)
from src.learning.planner import PlannerRequest, StubLearningPlanner
from src.learning.repository import LearningRepository
from src.learning.validator import PlanValidator, catalogue_grounding_rule
from src.learning.xapi import (
    DiagnosticCompletionEvent,
    XAPIStatement,
    diagnostic_completion_event_to_xapi,
    mastery_event_to_xapi,
)


class DiagnosticItemBank(LanguageAndProvenanceModel):
    diagnostic_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    skills: List[Skill] = Field(min_length=1)
    items: List[DiagnosticItem] = Field(min_length=1)


class DiagnosticAnswer(ContractModel):
    item_id: str = Field(min_length=1)
    response_text: str = Field(min_length=1)


class DiagnosticSession(LanguageAndProvenanceModel):
    session_id: str = Field(default_factory=lambda: f"diagnostic-session-{uuid4().hex[:12]}")
    diagnostic_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    class_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    status: Literal["started", "completed"]
    selected_item_ids: List[str] = Field(min_length=1)


class HeatmapCell(LanguageAndProvenanceModel):
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    skill_label: str = Field(min_length=1)
    probability: float = Field(ge=0.0, le=1.0)
    uncertainty: float = Field(ge=0.0, le=1.0)
    status: Literal["secure", "developing", "needs_support"]


class TeacherHeatmap(LanguageAndProvenanceModel):
    tenant_id: str = Field(min_length=1)
    class_id: str = Field(min_length=1)
    diagnostic_id: str = Field(min_length=1)
    cells: List[HeatmapCell] = Field(min_length=1)


class DiagnosticRunResult(LanguageAndProvenanceModel):
    session: DiagnosticSession
    responses: List[StudentResponse] = Field(min_length=1)
    mastery_events: List[MasteryEvent] = Field(min_length=1)
    xapi_statements: List[XAPIStatement] = Field(min_length=1)
    heatmap: TeacherHeatmap
    pending_plan: InterventionPlan


class DiagnosticItemSelector(Protocol):
    offline_fallback_available: bool

    def select_items(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> List[DiagnosticItem]: ...


class DeterministicItemSelector:
    """Round-robin item selector that gives each skill early coverage offline."""

    offline_fallback_available = True

    def select_items(
        self,
        item_bank: DiagnosticItemBank,
        prior_mastery: Mapping[str, MasteryEstimate],
        limit: int,
    ) -> List[DiagnosticItem]:
        grouped_items: Dict[str, List[DiagnosticItem]] = {skill.skill_id: [] for skill in item_bank.skills}
        for item in item_bank.items:
            grouped_items.setdefault(item.skill_id, []).append(item)
        for items in grouped_items.values():
            items.sort(key=lambda item: (item.difficulty, item.item_id))

        selected: List[DiagnosticItem] = []
        skill_order = sorted(grouped_items.keys(), key=lambda skill_id: prior_mastery.get(skill_id).probability if skill_id in prior_mastery else 0.5)
        while len(selected) < limit and any(grouped_items.values()):
            for skill_id in skill_order:
                if grouped_items[skill_id] and len(selected) < limit:
                    selected.append(grouped_items[skill_id].pop(0))
        return selected


def load_item_bank(path: Path) -> DiagnosticItemBank:
    return DiagnosticItemBank.model_validate(json.loads(path.read_text(encoding="utf-8")))


def normalize_answer(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


def score_answer(item: DiagnosticItem, answer: DiagnosticAnswer) -> bool:
    if item.correct_answer is None:
        return False
    return normalize_answer(answer.response_text) == normalize_answer(item.correct_answer)


def heatmap_status(estimate: MasteryEstimate) -> Literal["secure", "developing", "needs_support"]:
    if estimate.probability >= 0.75 and estimate.uncertainty <= 0.35:
        return "secure"
    if estimate.probability >= 0.5:
        return "developing"
    return "needs_support"


class DiagnosticEngine:
    def __init__(
        self,
        repository: LearningRepository,
        selector: Optional[DiagnosticItemSelector] = None,
        estimator: Optional[MasteryEstimator] = None,
    ) -> None:
        self.repository = repository
        self.selector = selector or DeterministicItemSelector()
        self.estimator = estimator or BetaBKT()

    def run_offline(
        self,
        item_bank: DiagnosticItemBank,
        tenant_id: str,
        class_id: str,
        student_id: str,
        teacher_id: str,
        answers: Optional[List[DiagnosticAnswer]] = None,
        target_item_count: int = 50,
    ) -> DiagnosticRunResult:
        selected_items = self.selector.select_items(item_bank, prior_mastery={}, limit=target_item_count)
        if len(selected_items) != min(target_item_count, len(item_bank.items)):
            raise RuntimeError("diagnostic_selector_returned_unexpected_item_count")

        answer_by_item_id = {answer.item_id: answer for answer in answers or []}
        session = DiagnosticSession(
            diagnostic_id=item_bank.diagnostic_id,
            tenant_id=tenant_id,
            class_id=class_id,
            student_id=student_id,
            status="completed",
            selected_item_ids=[item.item_id for item in selected_items],
            lang=item_bank.lang,
            provenance=item_bank.provenance,
        )
        latest_estimates: Dict[str, MasteryEstimate] = {}
        responses: List[StudentResponse] = []
        mastery_events: List[MasteryEvent] = []
        xapi_statements: List[XAPIStatement] = []

        for item in selected_items:
            answer = answer_by_item_id.get(
                item.item_id,
                DiagnosticAnswer(item_id=item.item_id, response_text=item.correct_answer or ""),
            )
            response = StudentResponse(
                tenant_id=tenant_id,
                student_id=student_id,
                item_id=item.item_id,
                skill_id=item.skill_id,
                response_text=answer.response_text,
                correct=score_answer(item, answer),
                lang=item.lang,
                provenance=item.provenance,
            )
            self.repository.save_student_response(response, idempotency_key=f"{session.session_id}:{item.item_id}")
            responses.append(response)

            update = self.estimator.update(
                MasteryUpdateInput(
                    tenant_id=tenant_id,
                    student_id=student_id,
                    skill_id=item.skill_id,
                    correct=response.correct,
                    prior_estimate=latest_estimates.get(item.skill_id),
                    item_difficulty=item.difficulty,
                    lang=item.lang,
                    provenance=item.provenance,
                )
            )
            latest_estimates[item.skill_id] = update.estimate
            mastery_event = MasteryEvent(
                tenant_id=tenant_id,
                student_id=student_id,
                skill_id=item.skill_id,
                response_id=response.response_id,
                estimate=update.estimate,
                lang=update.lang,
                provenance=update.provenance,
            )
            statement = mastery_event_to_xapi(mastery_event)
            self.repository.save_mastery_event(mastery_event, statement)
            self.repository.emit_xapi_statement(tenant_id, student_id, statement, "ralph_queued")
            mastery_events.append(mastery_event)
            xapi_statements.append(statement)

        completion_event = DiagnosticCompletionEvent(
            tenant_id=tenant_id,
            student_id=student_id,
            diagnostic_id=item_bank.diagnostic_id,
            item_count=len(selected_items),
            lang=item_bank.lang,
            provenance=item_bank.provenance,
        )
        completion_statement = diagnostic_completion_event_to_xapi(completion_event)
        self.repository.emit_xapi_statement(tenant_id, student_id, completion_statement, "ralph_queued")
        xapi_statements.append(completion_statement)

        heatmap = build_teacher_heatmap(
            tenant_id=tenant_id,
            class_id=class_id,
            diagnostic_id=item_bank.diagnostic_id,
            student_id=student_id,
            skills=item_bank.skills,
            estimates=latest_estimates,
            lang=item_bank.lang,
            provenance=item_bank.provenance,
        )
        planner_result = StubLearningPlanner().run_turn(
            PlannerRequest(
                tenant_id=tenant_id,
                actor_id=teacher_id,
                role="teacher",
                prompt="Suggest intervention groups for the completed JSS2 diagnostic.",
                scope={"skill_ids": [cell.skill_id for cell in heatmap.cells], "student_ids": [student_id]},
                offline=True,
                lang=item_bank.lang,
                provenance=item_bank.provenance,
            )
        )
        validation = PlanValidator([catalogue_grounding_rule([skill.skill_id for skill in item_bank.skills])]).validate(planner_result.plan)
        if not validation.ok:
            raise RuntimeError(validation.audit_reason or "phase_2_plan_validation_failed")
        self.repository.save_intervention_plan(planner_result.plan, tenant_id=tenant_id, actor_id=teacher_id, status="pending")

        return DiagnosticRunResult(
            session=session,
            responses=responses,
            mastery_events=mastery_events,
            xapi_statements=xapi_statements,
            heatmap=heatmap,
            pending_plan=planner_result.plan,
            lang=item_bank.lang,
            provenance=item_bank.provenance,
        )


def build_teacher_heatmap(
    tenant_id: str,
    class_id: str,
    diagnostic_id: str,
    student_id: str,
    skills: List[Skill],
    estimates: Mapping[str, MasteryEstimate],
    lang: str,
    provenance: List[Provenance],
) -> TeacherHeatmap:
    cells = []
    for skill in skills:
        estimate = estimates.get(skill.skill_id)
        if estimate is None:
            continue
        cells.append(
            HeatmapCell(
                student_id=student_id,
                skill_id=skill.skill_id,
                skill_label=skill.name,
                probability=estimate.probability,
                uncertainty=estimate.uncertainty,
                status=heatmap_status(estimate),
                lang=lang,
                provenance=provenance,
            )
        )
    return TeacherHeatmap(
        tenant_id=tenant_id,
        class_id=class_id,
        diagnostic_id=diagnostic_id,
        cells=cells,
        lang=lang,
        provenance=provenance,
    )