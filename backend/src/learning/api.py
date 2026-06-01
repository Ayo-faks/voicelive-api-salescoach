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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Protocol, Tuple
from urllib.parse import urlencode
from uuid import uuid4

import jwt
from flask import Flask, Response, jsonify, redirect, request

from src.learning.diagnostic import (
    DeterministicItemSelector,
    DiagnosticItemBank,
    heatmap_status,
    load_item_bank,
    load_subject_diagnostics,
    normalize_answer,
)
from src.learning.errors import LearningApiError
from src.learning.lti import (
    JWKSProvider,
    LTIPlatformConfig,
    LTIValidationError,
    LTILaunchVerifier,
    LTIStateStore,
    fetch_jwks,
    session_expiry_timestamp,
)
from src.learning.mastery import BetaBKT, MasteryEstimator, MasteryUpdateInput
from src.learning.models import (
    CatalogueSkill,
    DiagnosticItem,
    InterventionPlan,
    LearnerDailyPlan,
    LearnerDailyPlanItem,
    LearnerWeakTopic,
    MasteryEstimate,
    MasteryEvent,
    Provenance,
    StudentFactProposal,
    StudentLearningEvidence,
    StudentLearningInsight,
    StudentResponse,
    VoiceFluencyResult,
)
from src.learning.observability import LearningObservability
from src.learning.operations import compute_kpi_report, load_metric_snapshots
from src.learning.planner import PlannerRequest, StubLearningPlanner
from src.learning.rag import (
    DEFAULT_SIMILARITY_THRESHOLD,
    DEFAULT_TOP_K,
    RagRetriever,
    WikiCorpus,
    load_wiki_corpus,
    retrieve_or_refuse,
)
from src.learning.notifications import (
    InMemoryNotificationsRepository,
    NotificationsRepository,
    PushSubscription,
    RevisionCard,
    VapidConfig,
    load_vapid_config,
)
from src.learning.repository import InMemoryLearningRepository, LearningRepository
from src.learning.skills import SkillCatalogueError, SkillsCatalogueService
from src.learning.tts.routes import create_learning_tts_blueprint
from src.learning.validator import (
    PlanValidator,
    catalogue_grounding_rule,
    catalogue_skill_existence_rule,
)
from src.learning.voice import FlaskSockVoiceTransportAdapter, VoiceFrame
from src.learning.learner_voice import (
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
)
from src.learning.xapi import (
    ApprovalEvent,
    DiagnosticCompletionEvent,
    LTILaunchEvent,
    OverrideEvent,
    RalphXAPISink,
    StudentFactDecisionEvent,
    StudentProfileViewEvent,
    XAPIStatement,
    approval_event_to_xapi,
    build_ralph_sink_from_env,
    diagnostic_completion_event_to_xapi,
    lti_launch_event_to_xapi,
    mastery_event_to_xapi,
    override_event_to_xapi,
    student_fact_decision_event_to_xapi,
    student_profile_view_event_to_xapi,
)


PILOT_TENANT_ID = "tenant-phase-2"
PILOT_CLASS_ID = "class-jss2-a"
PILOT_STUDENT_ID = "pilot-jss2-student-001"
PILOT_TEACHER_ID = "pilot-jss2-teacher-001"
PILOT_DIAGNOSTIC_ITEMS_PER_RUN = 12
PILOT_KPI_TENANT_ID = "tenant-phase-4"
VOICE_FEATURE_FLAG_ENV = "PATHFINDER_VOICE_ENABLED"
PILOT_STUDENT_FACTS = (
    {
        "fact_id": "student-fact-pilot-tobi-ratio-worked-examples",
        "student_id": "student-001",
        "student_name": "Tobi A.",
        "key": "learning_support",
        "value": "Needs worked examples before independent ratio practice",
        "evidence": "Diagnostic response pattern + exit ticket",
    },
    {
        "fact_id": "student-fact-pilot-ibrahim-fraction-visuals",
        "student_id": "student-003",
        "student_name": "Ibrahim S.",
        "key": "learning_modality",
        "value": "Fraction bar visuals improve accuracy",
        "evidence": "Three recent fraction attempts",
    },
    {
        "fact_id": "student-fact-pilot-zainab-voice-prompts",
        "student_id": "student-008",
        "student_name": "Zainab H.",
        "key": "access_preference",
        "value": "Prefers short voice prompts for review tasks",
        "evidence": "Reading drill completion logs",
    },
)
PILOT_PENDING_PLAN_ID = "plan-jss2-ratio-recovery"
PILOT_VOICE_FLUENCY_RESULTS = {
    "student-001": {
        "score": 72.0,
        "label": "Developing oral reading fluency",
        "evidence": "Latest oral-reading check: 72/100 fluency, hesitations around ratio vocabulary.",
        "captured_at": "2026-05-24T09:15:00+00:00",
    },
    "student-003": {
        "score": 64.0,
        "label": "Needs paced reading support",
        "evidence": "Latest oral-reading check: 64/100 fluency, pauses increased on multi-step fraction wording.",
        "captured_at": "2026-05-24T09:20:00+00:00",
    },
    "student-008": {
        "score": 81.0,
        "label": "Comfortable with short voice prompts",
        "evidence": "Latest oral-reading check: 81/100 fluency, strongest on short review prompts.",
        "captured_at": "2026-05-24T09:28:00+00:00",
    },
}


def _resolve_learning_data_dir() -> Path:
    module_path = Path(__file__).resolve()
    candidates = [
        module_path.parents[3] / "data" / "learning",
        module_path.parents[2] / "data" / "learning",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


LEARNING_DATA_DIR = _resolve_learning_data_dir()
ITEM_BANK_PATH = LEARNING_DATA_DIR / "jss2_maths_diagnostic_phase_2.json"
DIAGNOSTICS_DIR = LEARNING_DATA_DIR / "diagnostics"
PILOT_METRICS_PATH = LEARNING_DATA_DIR / "ops" / "phase_4_pilot_metrics.json"
WIKI_CORPUS_PATH = LEARNING_DATA_DIR / "wiki" / "jss3_maths_wiki_seed.json"
WIKI_CORPUS_PATHS = (
    WIKI_CORPUS_PATH,
    LEARNING_DATA_DIR / "wiki" / "english_jss3_ss3_wiki_seed.json",
)
EXPLAIN_SNIPPET_MAX_CHARS = 320


class AssistantReply(dict):
    """Lightweight dict-typed reply returned by an ``AssistantProvider``.

    Carries the assistant's free-text answer and an optional list of citation
    cards ``[{"label": str, "topic_id"|"url": str}]``. Kept as a ``dict``
    subclass so it serialises cleanly via ``jsonify`` without an extra adapter.
    """


class AssistantProvider(Protocol):
    """Pluggable backend for the unified Ask Pathfinder drawer.

    Phase 1 ships a deterministic implementation that quotes the learner's own
    weak topics, daily plan, and career fits back to them; phase 2 will swap in
    a model-backed provider (see ``/memories/repo/pathfinder-ask-assistant-phase2.md``).
    """

    def ask(self, question: str, context: Mapping[str, Any]) -> AssistantReply: ...


class DeterministicAssistantProvider:
    """Phase-1 provider — branches on keywords in the learner's question.

    Pulls signals directly from ``context`` so the same data the learner sees
    on the home screen (weak topics, daily plan, career fits, last wrong
    answer) appears in the answer. No outcome guarantees.
    """

    def ask(self, question: str, context: Mapping[str, Any]) -> AssistantReply:
        q = (question or "").strip()
        ql = q.lower()
        weak_topics = list(context.get("weak_topics") or [])
        career_fits = list(context.get("career_fits") or [])
        daily_plan = list(context.get("daily_plan") or [])
        last_wrong = context.get("last_wrong_answer") or {}

        def _topic_label(t: Any) -> str:
            if isinstance(t, Mapping):
                return str(t.get("label") or t.get("skill_id") or t.get("topic_id") or "")
            return str(t or "")

        def _topic_id(t: Any) -> str:
            if isinstance(t, Mapping):
                return str(t.get("skill_id") or t.get("topic_id") or t.get("label") or "")
            return str(t or "")

        weak_labels = [_topic_label(t) for t in weak_topics if _topic_label(t)]
        citations: List[Dict[str, str]] = []

        # 1) Wrong-answer follow-up
        if last_wrong and any(k in ql for k in ("why", "wrong", "mistake", "explain")):
            topic = _topic_label(last_wrong) or "this topic"
            answer = (
                f"Looking at your last answer on {topic}, the worked example "
                "shows what to keep constant; try the next short retrieval "
                "card to practise the same step in a new wording. No outcome "
                "guarantee — what is realistic is one focused retry today."
            )
            tid = _topic_id(last_wrong)
            if tid:
                citations.append({"label": topic, "topic_id": tid})
            return AssistantReply(answer=answer, citations=citations)

        # 2) Career / pathway question
        if any(k in ql for k in ("career", "pathway", "doctor", "engineer", "become", "job", "future")):
            fit_labels = [str((f or {}).get("label") or f) for f in career_fits if f]
            if fit_labels:
                fits_text = ", ".join(fit_labels[:3])
                answer = (
                    f"Pathways that fit your current strengths include {fits_text}. "
                    "Guidance stays exploratory — no outcome guarantee. What is "
                    "realistic next: keep building "
                    + (weak_labels[0] if weak_labels else "your current focus topic")
                    + " before timed practice."
                )
            else:
                answer = (
                    "Pathways stay exploratory — no outcome guarantee. What is "
                    "realistic next: name the subject you most enjoy and we can "
                    "map two adjacent roles to try."
                )
            for f in career_fits[:3]:
                if isinstance(f, Mapping) and f.get("label"):
                    citations.append({"label": str(f["label"]), "url": str(f.get("url") or "#")})
            return AssistantReply(answer=answer, citations=citations)

        # 3) Weak-topic / what-to-study question (default branch)
        focus = weak_labels[0] if weak_labels else "your current focus topic"
        plan_titles = [str((p or {}).get("title") or p) for p in daily_plan if p]
        plan_text = ("; ".join(plan_titles[:2])) if plan_titles else "today's path"
        answer = (
            f"Start with {focus} — that is the weakest signal on your profile "
            f"right now. Today's path covers: {plan_text}. Aim for one short "
            "retrieval card after each step; no outcome guarantee, just "
            "steady practice."
        )
        for t in weak_topics[:2]:
            label = _topic_label(t)
            tid = _topic_id(t)
            if label and tid:
                citations.append({"label": label, "topic_id": tid})
        return AssistantReply(answer=answer, citations=citations)


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
        sink: Optional[RalphXAPISink] = None,
        lti_platforms: Optional[List[LTIPlatformConfig]] = None,
        lti_jwks_provider: Optional[JWKSProvider] = None,
        lti_state_store: Optional[LTIStateStore] = None,
        lti_session_secret: Optional[str] = None,
        observability: Optional[LearningObservability] = None,
        wiki_corpus: Optional[WikiCorpus] = None,
        rag_retriever: Optional[RagRetriever] = None,
        notifications_repository: Optional[NotificationsRepository] = None,
        vapid_config: Optional[VapidConfig] = None,
        assistant_provider: Optional[AssistantProvider] = None,
    ) -> None:
        self.repository: LearningRepository = repository or InMemoryLearningRepository()
        self.item_bank: DiagnosticItemBank = item_bank or load_item_bank(ITEM_BANK_PATH)
        self.estimator: MasteryEstimator = estimator or BetaBKT()
        self.sink: RalphXAPISink = sink or build_ralph_sink_from_env(repository=self.repository)
        self.lti_verifier = LTILaunchVerifier(lti_platforms or [], lti_jwks_provider or fetch_jwks)
        self.lti_state_store = lti_state_store or LTIStateStore()
        self.lti_session_secret = lti_session_secret or os.environ.get("LTI_SESSION_SECRET")
        self.observability = observability or LearningObservability()
        self.selector = DeterministicItemSelector()
        self.voice_adapter = FlaskSockVoiceTransportAdapter()
        self.learner_voice_planner = LearnerVoiceTurnPlanner()
        self.assistant_provider: AssistantProvider = (
            assistant_provider or DeterministicAssistantProvider()
        )
        self._sessions: Dict[str, _SessionState] = {}
        self._student_estimates: Dict[Tuple[str, str], Dict[str, MasteryEstimate]] = {}
        self._student_classes: Dict[Tuple[str, str], str] = {}
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
        # Slug-normalised lookup so client-facing subject slugs (e.g.
        # "mathematics", "english") resolve to banks keyed by their raw subject
        # ("maths-jss3-ss3", "english-jss3-ss3"). First bank per slug wins,
        # which keeps the richer JSS3/SS3 banks ahead of small phase-2 fixtures.
        self._banks_by_subject_slug: Dict[str, DiagnosticItemBank] = {}
        for bank in registry_banks:
            self._banks_by_subject_slug.setdefault(
                _exam_prep_subject_slug(bank.subject), bank
            )

        seen: Dict[str, None] = {}
        for bank in registry_banks:
            for skill in bank.skills:
                seen.setdefault(skill.skill_id, None)
        self._allowed_skill_ids = list(seen.keys())
        self._validator: PlanValidator[InterventionPlan] = PlanValidator(
            [catalogue_grounding_rule(self._allowed_skill_ids)]
        )
        self.skills_service = SkillsCatalogueService(self.repository)
        self._seed_pilot_pending_plan()
        self._seed_pilot_student_fact_proposals()

        # RAG retriever (W3-B). Lazy seed from the bundled wiki fixture when
        # the caller doesn't pass a corpus. Missing fixture → empty corpus;
        # every explain() call then refuses with reason="no_grounding".
        if rag_retriever is not None:
            self.rag_retriever: RagRetriever = rag_retriever
        else:
            if wiki_corpus is None:
                merged_nodes: List[Any] = []
                for path in WIKI_CORPUS_PATHS:
                    if path.exists():
                        merged_nodes.extend(load_wiki_corpus(path).nodes())
                wiki_corpus = WikiCorpus(merged_nodes)
            self.rag_retriever = RagRetriever(
                wiki_corpus,
                similarity_threshold=DEFAULT_SIMILARITY_THRESHOLD,
                top_k=DEFAULT_TOP_K,
            )

        # W8 — Spaced-retrieval Web Push.
        self.notifications_repository: NotificationsRepository = (
            notifications_repository or InMemoryNotificationsRepository()
        )
        self.vapid_config: VapidConfig = vapid_config or load_vapid_config()

    def _seed_pilot_pending_plan(self) -> None:
        if not isinstance(self.repository, InMemoryLearningRepository):
            return
        if any(
            record["tenant_id"] == PILOT_TENANT_ID
            and record.get("class_id") == PILOT_CLASS_ID
            and record["status"] == "pending"
            for record in self._pending_plans.values()
        ):
            return
        plan = InterventionPlan(
            plan_id=PILOT_PENDING_PLAN_ID,
            target_skill_ids=["ratio-proportion", "fraction-operations"],
            target_student_ids=["student-001", "student-014", "student-022"],
            item_types=["worked_example", "short_answer", "exit_ticket"],
            suggested_resources=[
                "ratio table mini-lesson",
                "fraction bar check-in",
                "teacher-led exit ticket",
            ],
            rationale=(
                "Pathfinder proposes a small-group 1-2 week ratio recovery plan "
                "based on low mastery and high diagnostic uncertainty."
            ),
            requires_approval=True,
            lang=self.item_bank.lang,
            provenance=[
                Provenance(
                    source="LearningApi.seed_pilot_pending_plan",
                    rule_id="pilot_pending_practice_plan",
                    confidence=0.9,
                    evidence_count=3,
                )
            ],
        )
        record = self.repository.save_intervention_plan(
            plan,
            tenant_id=PILOT_TENANT_ID,
            actor_id="pathfinder-planner",
            status="pending",
        )
        record["class_id"] = PILOT_CLASS_ID
        self._pending_plans[plan.plan_id] = record

    def _seed_pilot_student_fact_proposals(self) -> None:
        if not isinstance(self.repository, InMemoryLearningRepository):
            return
        existing = self.repository.list_student_facts(
            PILOT_TENANT_ID,
            class_id=PILOT_CLASS_ID,
            status="pending",
        )
        if existing:
            return
        provenance = [
            Provenance(
                source="LearningApi.student_fact_detector",
                rule_id="pilot_detected_student_fact",
                confidence=0.82,
                evidence_count=1,
            )
        ]
        for seed in PILOT_STUDENT_FACTS:
            fact = StudentFactProposal(
                tenant_id=PILOT_TENANT_ID,
                class_id=PILOT_CLASS_ID,
                lang=self.item_bank.lang,
                provenance=provenance,
                **seed,
            )
            self.repository.save_student_fact(fact, actor_id="pathfinder-detector", status="pending")

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
            if not filtered:
                # Large banks round-robin a sample across all skills, so a
                # specific exam-prep topic may be absent. Serve its items
                # directly so targeted practice always lands on the topic.
                direct = sorted(
                    (
                        item
                        for item in bank.items
                        if item.skill_id == target_skill_id
                    ),
                    key=lambda item: (item.difficulty, item.item_id),
                )
                filtered = direct[:item_count]
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
            self._student_classes[(tenant_id, student_id)] = class_id
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
                bank = self._banks_by_subject_slug.get(
                    _exam_prep_subject_slug(str(subject))
                )
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
        self._emit_xapi(state.tenant_id, state.student_id, statement)

        state.current_index += 1
        next_item_payload: Optional[Dict[str, Any]] = None
        pending_plan_payload: Optional[Dict[str, Any]] = None
        pending_fact_payload: List[Dict[str, Any]] = []
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
            self._emit_xapi(state.tenant_id, state.student_id, completion_statement)
            completion_payload = completion_statement.model_dump()
            pending_plan_payload = self._build_and_persist_pending_plan(state)
            pending_fact_payload = self._detect_student_facts_from_session(state)
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
            "pending_facts": pending_fact_payload,
            "completion_xapi": completion_payload,
        }

    def _detect_student_facts_from_session(self, state: _SessionState) -> List[Dict[str, Any]]:
        if not state.estimates:
            return []
        weakest_skill_id, weakest_estimate = min(
            state.estimates.items(),
            key=lambda item: item[1].probability,
        )
        if weakest_estimate.probability >= 0.65:
            return []
        existing = self.repository.list_student_facts(
            state.tenant_id,
            class_id=state.class_id,
            student_id=state.student_id,
        )
        key = f"diagnostic_gap:{weakest_skill_id}"
        if any(record["fact"].get("key") == key for record in existing):
            return []
        skill_label = next(
            (skill.name for skill in state.bank.skills if skill.skill_id == weakest_skill_id),
            weakest_skill_id,
        )
        fact = StudentFactProposal(
            tenant_id=state.tenant_id,
            class_id=state.class_id,
            student_id=state.student_id,
            key=key,
            value=f"Needs targeted practice on {skill_label}",
            evidence=(
                f"Diagnostic {state.diagnostic_id} completed with "
                f"{weakest_estimate.probability:.0%} mastery estimate"
            ),
            lang=state.bank.lang,
            provenance=[
                Provenance(
                    source="LearningApi._detect_student_facts_from_session",
                    source_id=state.session_id,
                    rule_id="lowest_mastery_below_threshold",
                    confidence=0.78,
                    evidence_count=len(state.responses),
                    metadata={"skill_id": weakest_skill_id},
                )
            ],
        )
        record = self.repository.save_student_fact(fact, actor_id="pathfinder-detector", status="pending")
        self._record_audit(
            tenant_id=state.tenant_id,
            actor_id=state.student_id,
            label=f"Detected pending student fact for {state.student_id}",
            kind="student_fact_proposed",
        )
        return [record]

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
            if self._student_classes.get((event_tenant, student_id), PILOT_CLASS_ID) != class_id:
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

    # ------------------------------------------------------------------
    # Student drilldown (HITL teacher surface)
    # ------------------------------------------------------------------
    def get_student_profile(
        self, student_id: str, payload: Mapping[str, Any]
    ) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)

        skill_labels: Dict[str, str] = {}
        for bank in self._banks_by_id.values():
            for skill in bank.skills:
                skill_labels.setdefault(skill.skill_id, skill.name)

        estimates_by_skill = self._student_estimates.get((tenant_id, student_id), {})
        skills_payload: List[Dict[str, Any]] = []
        for skill_id, estimate in estimates_by_skill.items():
            skills_payload.append(
                {
                    "skill_id": skill_id,
                    "skill_label": skill_labels.get(skill_id, skill_id),
                    "probability": estimate.probability,
                    "uncertainty": estimate.uncertainty,
                    "kind": estimate.kind,
                    "status": heatmap_status(estimate),
                }
            )

        mastery_events = getattr(self.repository, "mastery_events", []) or []
        recent_events = [
            rec
            for rec in mastery_events
            if rec.get("tenant_id") == tenant_id and rec.get("student_id") == student_id
        ][-20:]
        responses = getattr(self.repository, "student_responses", []) or []
        recent_responses = [
            rec
            for rec in responses
            if rec.get("tenant_id") == tenant_id and rec.get("student_id") == student_id
        ][-20:]
        strengths_payload, gaps_payload = self._student_profile_insights(
            skills_payload,
            recent_responses,
            recent_events,
        )
        pending_facts = self.repository.list_student_facts(
            tenant_id,
            student_id=student_id,
            status="pending",
        )

        event = StudentProfileViewEvent(
            tenant_id=tenant_id,
            actor_id=actor_id,
            student_id=student_id,
            skill_count=len(skills_payload),
            lang=self.item_bank.lang,
            provenance=self.item_bank.provenance,
        )
        statement = student_profile_view_event_to_xapi(event)
        self._emit_xapi(tenant_id, actor_id, statement)
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Viewed profile for {student_id}",
            kind="student_profile_view",
        )

        return {
            "tenant_id": tenant_id,
            "student_id": student_id,
            "skills": skills_payload,
            "strengths": strengths_payload,
            "gaps": gaps_payload,
            "voice_fluency": self._voice_fluency_for_student(student_id),
            "proposed_student_facts": pending_facts,
            "approved_student_facts": self._approved_student_facts(
                tenant_id,
                student_id=student_id,
            ),
            "recent_mastery_events": recent_events,
            "recent_responses": recent_responses,
            "xapi_id": statement.id,
            "audit": self._audit_events[-1],
        }

    def _student_profile_insights(
        self,
        skills_payload: List[Dict[str, Any]],
        recent_responses: List[Dict[str, Any]],
        recent_events: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        strengths: List[Dict[str, Any]] = []
        gaps: List[Dict[str, Any]] = []
        for skill in skills_payload:
            evidence = self._evidence_for_skill(skill, recent_responses, recent_events)
            insight = StudentLearningInsight(
                skill_id=skill["skill_id"],
                skill_label=skill["skill_label"],
                probability=skill["probability"],
                uncertainty=skill["uncertainty"],
                status=skill["status"],
                evidence=evidence,
            ).model_dump()
            if skill["status"] == "secure":
                strengths.append(insight)
            else:
                gaps.append(insight)
        return strengths, gaps

    def _evidence_for_skill(
        self,
        skill: Dict[str, Any],
        recent_responses: List[Dict[str, Any]],
        recent_events: List[Dict[str, Any]],
    ) -> List[StudentLearningEvidence]:
        skill_id = skill["skill_id"]
        evidence: List[StudentLearningEvidence] = []
        for response in [rec for rec in recent_responses if rec.get("skill_id") == skill_id][-3:]:
            correct = response.get("correct")
            correctness = "Correct" if correct is True else "Incorrect" if correct is False else "Recorded"
            evidence.append(
                StudentLearningEvidence(
                    source="diagnostic_response",
                    summary=(
                        f"{correctness} diagnostic response"
                        f" {response.get('response_text')!r} on {response.get('item_id')}"
                    ),
                    skill_id=skill_id,
                    item_id=response.get("item_id"),
                    correct=correct if isinstance(correct, bool) else None,
                    confidence=0.9,
                )
            )
        for event in [rec for rec in recent_events if rec.get("skill_id") == skill_id][-1:]:
            estimate = event.get("estimate") if isinstance(event.get("estimate"), Mapping) else event
            probability = estimate.get("probability") if isinstance(estimate, Mapping) else None
            uncertainty = estimate.get("uncertainty") if isinstance(estimate, Mapping) else None
            if isinstance(probability, (int, float)) and isinstance(uncertainty, (int, float)):
                evidence.append(
                    StudentLearningEvidence(
                        source="mastery_model",
                        summary=(
                            f"Mastery model estimates {probability:.0%} mastery "
                            f"with {uncertainty:.0%} uncertainty"
                        ),
                        skill_id=skill_id,
                        confidence=0.82,
                    )
                )
        if not evidence:
            evidence.append(
                StudentLearningEvidence(
                    source="mastery_snapshot",
                    summary=(
                        f"Current profile estimate is {skill['probability']:.0%} mastery "
                        f"with {skill['uncertainty']:.0%} uncertainty"
                    ),
                    skill_id=skill_id,
                    confidence=0.72,
                )
            )
        return evidence

    def _voice_fluency_for_student(self, student_id: str) -> Dict[str, Any]:
        fixture = PILOT_VOICE_FLUENCY_RESULTS.get(student_id)
        provenance = [
            Provenance(
                source="LearningApi._voice_fluency_for_student",
                rule_id="pilot_oral_reading_fluency_snapshot" if fixture else "no_voice_fluency_sample",
                confidence=0.84 if fixture else 1.0,
                evidence_count=1 if fixture else 0,
            )
        ]
        if fixture:
            return VoiceFluencyResult(
                status="available",
                score=fixture["score"],
                label=fixture["label"],
                evidence=fixture["evidence"],
                captured_at=fixture["captured_at"],
                lang=self.item_bank.lang,
                provenance=provenance,
            ).model_dump()
        return VoiceFluencyResult(
            status="not_recorded",
            score=None,
            label="No voice fluency sample recorded",
            evidence="Pathfinder has not received an oral-reading fluency sample for this student yet.",
            captured_at=None,
            lang=self.item_bank.lang,
            provenance=provenance,
        ).model_dump()

    def override_mastery(
        self, student_id: str, payload: Mapping[str, Any]
    ) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)
        skill_id = str(payload.get("skill_id") or "").strip()
        reason = str(payload.get("reason") or "").strip()
        if not skill_id:
            raise LearningApiError("skill_id required", status_code=400)
        if not reason:
            raise LearningApiError("reason required", status_code=400)
        if skill_id not in self._allowed_skill_ids:
            raise LearningApiError(f"unknown skill_id: {skill_id}", status_code=404)
        try:
            probability = float(payload["probability"])
        except (KeyError, TypeError, ValueError) as exc:
            raise LearningApiError(
                "probability (0..1) required", status_code=400
            ) from exc
        if not 0.0 <= probability <= 1.0:
            raise LearningApiError(
                "probability must be between 0 and 1", status_code=400
            )
        uncertainty_raw = payload.get("uncertainty")
        try:
            uncertainty = (
                float(uncertainty_raw) if uncertainty_raw is not None else 0.1
            )
        except (TypeError, ValueError) as exc:
            raise LearningApiError(
                "uncertainty must be a number between 0 and 1", status_code=400
            ) from exc
        if not 0.0 <= uncertainty <= 1.0:
            raise LearningApiError(
                "uncertainty must be between 0 and 1", status_code=400
            )

        a = max(1e-3, probability * 50.0)
        b = max(1e-3, (1.0 - probability) * 50.0)
        new_estimate = MasteryEstimate(
            kind="beta", probability=probability, uncertainty=uncertainty, a=a, b=b
        )
        with self._lock:
            self._student_estimates.setdefault((tenant_id, student_id), {})[
                skill_id
            ] = new_estimate

        event = OverrideEvent(
            tenant_id=tenant_id,
            actor_id=actor_id,
            student_id=student_id,
            skill_id=skill_id,
            reason=reason,
            lang=self.item_bank.lang,
            provenance=self.item_bank.provenance,
        )
        statement = override_event_to_xapi(event)
        self._emit_xapi(tenant_id, actor_id, statement)
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Override mastery for {student_id}/{skill_id} -> p={probability:.2f}",
            kind="mastery_override",
        )
        return {
            "ok": True,
            "student_id": student_id,
            "skill_id": skill_id,
            "estimate": new_estimate.model_dump(),
            "status": heatmap_status(new_estimate),
            "xapi_id": statement.id,
            "audit": self._audit_events[-1],
        }

    # ------------------------------------------------------------------
    # xAPI emission (sink + repository)
    # ------------------------------------------------------------------
    def _emit_xapi(
        self, tenant_id: str, actor_id: str, statement: XAPIStatement
    ) -> Dict[str, Any]:
        emitted = self.sink.emit(statement)
        record = self.repository.emit_xapi_statement(
            tenant_id, actor_id, emitted, self.sink.sink_status
        )
        self.observability.record_xapi(self.sink.sink_status)
        return record

    def list_pending_approvals(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or "").strip()
        plans = [
            record
            for record in self._pending_plans.values()
            if record["tenant_id"] == tenant_id
            and record["status"] == "pending"
            and (not class_id or record.get("class_id") == class_id)
        ]
        return {"plans": plans, "count": len(plans)}

    def list_student_facts(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or "").strip() or None
        student_id = str(payload.get("student_id") or "").strip() or None
        status_raw = str(payload.get("status") or "pending").strip()
        status = None if status_raw == "all" else status_raw
        facts = self.repository.list_student_facts(
            tenant_id,
            class_id=class_id,
            student_id=student_id,
            status=status,
        )
        return {"facts": facts, "count": len(facts)}

    def propose_student_fact(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or PILOT_CLASS_ID)
        actor_id = str(payload.get("actor_id") or "pathfinder-detector")
        body = {
            "tenant_id": tenant_id,
            "class_id": class_id,
            "student_id": payload.get("student_id"),
            "student_name": payload.get("student_name"),
            "key": payload.get("key") or "teacher_observation",
            "value": payload.get("value") or payload.get("fact"),
            "evidence": payload.get("evidence"),
            "requires_approval": bool(payload.get("requires_approval", True)),
            "lang": payload.get("lang") or self.item_bank.lang,
            "provenance": payload.get("provenance") or [
                Provenance(
                    source="LearningApi.propose_student_fact",
                    rule_id="explicit_detector_submission",
                    confidence=0.8,
                    evidence_count=1,
                ).model_dump()
            ],
        }
        if payload.get("fact_id"):
            body["fact_id"] = payload.get("fact_id")
        try:
            fact = StudentFactProposal.model_validate(body)
        except Exception as exc:
            raise LearningApiError(f"invalid student fact: {exc}", status_code=400) from exc
        record = self.repository.save_student_fact(fact, actor_id=actor_id, status="pending")
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Proposed student fact for {fact.student_id}",
            kind="student_fact_proposed",
        )
        return {"fact": record, "queued": True, "audit": self._audit_events[-1]}

    def approve_student_fact(self, fact_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_student_fact(fact_id, payload, action="approved")

    def reject_student_fact(self, fact_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_student_fact(fact_id, payload, action="rejected")

    def edit_and_approve_student_fact(self, fact_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_student_fact(fact_id, payload, action="edited_approved")

    def _decide_student_fact(
        self,
        fact_id: str,
        payload: Mapping[str, Any],
        *,
        action: str,
    ) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)
        reason = str(payload.get("reason") or "").strip() or None
        matches = self.repository.list_student_facts(tenant_id, status=None)
        record = next((item for item in matches if item["id"] == fact_id), None)
        if record is None:
            raise LearningApiError(f"student fact {fact_id} not found", status_code=404)
        if record["status"] != "pending":
            raise LearningApiError(f"student fact {fact_id} is already {record['status']}", status_code=409)

        edited_fact: Optional[StudentFactProposal] = None
        if action == "edited_approved":
            edits = payload.get("edits") or {}
            if not isinstance(edits, Mapping):
                raise LearningApiError("edits must be an object", status_code=400)
            edited_body = {
                **record["fact"],
                **{k: edits[k] for k in ("key", "value", "evidence", "student_name") if k in edits},
            }
            try:
                edited_fact = StudentFactProposal.model_validate(edited_body)
            except Exception as exc:
                raise LearningApiError(f"invalid edited student fact: {exc}", status_code=400) from exc

        event = StudentFactDecisionEvent(
            tenant_id=tenant_id,
            actor_id=actor_id,
            fact_id=fact_id,
            student_id=record["student_id"],
            action=action,  # type: ignore[arg-type]
            reason=reason,
            lang=record["lang"],
            provenance=[Provenance.model_validate(item) for item in record["provenance"]],
        )
        statement = student_fact_decision_event_to_xapi(event)
        decision = self.repository.record_student_fact_decision(event, statement, edited_fact=edited_fact)
        self._emit_xapi(tenant_id, actor_id, statement)
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"{action.replace('_', ' ').title()} student fact {fact_id}",
            kind=f"student_fact_{action}",
        )
        facts_after = self.repository.list_student_facts(tenant_id, status=None)
        updated = next((item for item in facts_after if item["id"] == fact_id), record)
        return {
            "ok": True,
            "fact_id": fact_id,
            "action": action,
            "fact": updated,
            "decision": decision,
            "xapi_id": statement.id,
            "xapi_statement": statement.model_dump(),
            "audit": self._audit_events[-1],
        }

    def _approved_student_facts(
        self,
        tenant_id: str,
        *,
        class_id: Optional[str] = None,
        student_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        facts = self.repository.list_student_facts(
            tenant_id,
            class_id=class_id,
            student_id=student_id,
            status=None,
        )
        return [record for record in facts if record["status"] in {"approved", "edited_approved"}]

    def approve_plan(self, plan_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_plan(plan_id, payload, action="approved")

    def reject_plan(self, plan_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self._decide_plan(plan_id, payload, action="rejected")

    def edit_and_approve_plan(
        self, plan_id: str, payload: Mapping[str, Any]
    ) -> Dict[str, Any]:
        """Persist a teacher-edited variant of ``plan_id`` and approve it.

        Creates a new ``InterventionPlan`` whose ``parent_plan_id`` links
        back to the original. The original plan is marked ``edited_approved``
        via :meth:`record_approval` and the audit/xAPI trail is preserved.
        """

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
        edits = payload.get("edits") or {}
        if not isinstance(edits, Mapping):
            raise LearningApiError("edits must be an object", status_code=400)

        original_plan = record["plan"]
        edited_body = {
            **original_plan,
            **{k: edits[k] for k in (
                "target_skill_ids",
                "target_student_ids",
                "item_types",
                "suggested_resources",
                "rationale",
            ) if k in edits},
        }
        edited_body["plan_id"] = f"intervention-plan-{uuid4().hex[:12]}"
        edited_body["parent_plan_id"] = plan_id

        try:
            edited_plan = InterventionPlan.model_validate(edited_body)
        except Exception as exc:  # pydantic.ValidationError
            raise LearningApiError(
                f"invalid edited plan: {exc}", status_code=400
            ) from exc

        validation = self._validator.validate(edited_plan)
        if not validation.ok:
            raise LearningApiError(
                validation.audit_reason or "edited_plan_validation_failed",
                status_code=422,
            )

        edited_record = self.repository.save_intervention_plan(
            edited_plan,
            tenant_id=tenant_id,
            actor_id=actor_id,
            status="edited_approved",
        )
        edited_record["class_id"] = record.get("class_id")
        self._pending_plans[edited_plan.plan_id] = edited_record

        event = ApprovalEvent(
            tenant_id=tenant_id,
            actor_id=actor_id,
            plan_id=plan_id,
            action="edited_approved",
            reason=str(reason) if reason else None,
            lang=record["lang"],
            provenance=[Provenance.model_validate(item) for item in record["provenance"]],
        )
        statement = approval_event_to_xapi(event)
        self.repository.record_approval(event, statement)
        self._emit_xapi(tenant_id, actor_id, statement)
        record["status"] = "edited_approved"
        record["decided_by"] = actor_id
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=actor_id,
            label=f"Edited & approved plan {plan_id} as {edited_plan.plan_id}",
            kind="plan_edited_approved",
        )
        return {
            "ok": True,
            "plan_id": plan_id,
            "edited_plan_id": edited_plan.plan_id,
            "action": "edited_approved",
            "plan": edited_plan.model_dump(),
            "xapi_id": statement.id,
            "xapi_statement": statement.model_dump(),
            "audit": self._audit_events[-1],
        }

    def submit_intent(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        class_id = str(payload.get("class_id") or PILOT_CLASS_ID)
        actor_id = str(payload.get("actor_id") or PILOT_TEACHER_ID)
        role = str(payload.get("role") or "teacher")
        prompt_text = str(payload.get("prompt") or "").strip()
        if not prompt_text:
            raise LearningApiError("prompt is required", status_code=400)

        approved_facts = self._approved_student_facts(tenant_id, class_id=class_id)

        request_model = PlannerRequest(
            tenant_id=tenant_id,
            actor_id=actor_id,
            role=role,
            prompt=prompt_text,
            scope={
                "skill_ids": self._allowed_skill_ids,
                "student_ids": self._student_ids_for_class(tenant_id, class_id)
                or [PILOT_STUDENT_ID],
                "approved_student_facts": [record["fact"] for record in approved_facts],
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
        record["class_id"] = class_id
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
            "personalization": {
                "approved_student_facts": [record["fact"] for record in approved_facts],
            },
        }

    def list_audit(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        events = [event for event in self._audit_events if event["tenant_id"] == tenant_id]
        return {"events": events[-50:]}

    # ------------------------------------------------------------------
    # Explanation surface (W3-B) — exposes the RAG retriever.
    # The generator (W4) will replace the placeholder `explanation: null`
    # field with a grounded ExplanationResult composed from these hits.
    # ------------------------------------------------------------------
    def explain(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        query = str(payload.get("query") or "").strip()
        if not query:
            raise LearningApiError("query is required", status_code=400)
        lang = str(payload.get("lang") or "en")
        subject_raw = payload.get("subject")
        subject = str(subject_raw).strip() if subject_raw else None
        if subject and subject not in ("maths", "english"):
            raise LearningApiError(
                "subject must be 'maths' or 'english'", status_code=400
            )
        year_group_raw = payload.get("year_group")
        year_group = str(year_group_raw).strip() if year_group_raw else None
        if year_group and year_group not in ("JSS3", "SS3"):
            raise LearningApiError(
                "year_group must be 'JSS3' or 'SS3'", status_code=400
            )
        hits, refusal = retrieve_or_refuse(
            self.rag_retriever,
            query,
            lang=lang,
            subject=subject,  # type: ignore[arg-type]
            year_group=year_group,  # type: ignore[arg-type]
        )
        hits_payload: List[Dict[str, Any]] = []
        for hit in hits:
            snippet = hit.node.body_markdown
            if len(snippet) > EXPLAIN_SNIPPET_MAX_CHARS:
                snippet = snippet[: EXPLAIN_SNIPPET_MAX_CHARS - 1].rstrip() + "…"
            hits_payload.append(
                {
                    "node_id": hit.node.node_id,
                    "version": hit.node.version,
                    "title": hit.node.title,
                    "subject": hit.node.subject,
                    "year_group": hit.node.year_group,
                    "topic": hit.node.topic,
                    "anchor": hit.matched_anchor,
                    "score": hit.score,
                    "snippet": snippet,
                    "status": hit.node.status,
                }
            )
        return {
            "lang": lang,
            "query": query,
            "subject": subject,
            "year_group": year_group,
            "hits": hits_payload,
            "refusal": refusal.model_dump() if refusal is not None else None,
            "explanation": None,
            "similarity_threshold": self.rag_retriever.similarity_threshold,
        }

    # ------------------------------------------------------------------
    # LTI 1.3 launch flow (pilot/offline-first)
    # ------------------------------------------------------------------
    def initiate_lti_login(self, payload: Mapping[str, Any]) -> Dict[str, str]:
        issuer = str(payload.get("iss") or "").strip()
        login_hint = str(payload.get("login_hint") or "").strip()
        target_link_uri = str(payload.get("target_link_uri") or "").strip()
        client_id = str(payload.get("client_id") or "").strip() or None
        deployment_id = str(payload.get("lti_deployment_id") or "").strip() or None
        lti_message_hint = str(payload.get("lti_message_hint") or "").strip() or None
        if not issuer or not login_hint or not target_link_uri:
            raise LearningApiError("iss, login_hint and target_link_uri are required", status_code=400)

        platform = self.lti_verifier.find_platform(
            issuer=issuer,
            client_id=client_id,
            deployment_id=deployment_id,
        )
        state = self.lti_state_store.create(
            issuer=platform.issuer,
            client_id=platform.client_id,
            target_link_uri=target_link_uri,
            lti_message_hint=lti_message_hint,
            deployment_id=deployment_id,
        )
        query = {
            "response_type": "id_token",
            "response_mode": "form_post",
            "scope": "openid",
            "client_id": platform.client_id,
            "redirect_uri": target_link_uri,
            "login_hint": login_hint,
            "state": state.state,
            "nonce": state.nonce,
            "prompt": "none",
        }
        if lti_message_hint:
            query["lti_message_hint"] = lti_message_hint
        separator = "&" if "?" in platform.auth_login_url else "?"
        return {"redirect_url": f"{platform.auth_login_url}{separator}{urlencode(query)}"}

    def complete_lti_launch(self, payload: Mapping[str, Any]) -> str:
        id_token = str(payload.get("id_token") or "").strip()
        state_value = str(payload.get("state") or "").strip()
        if not id_token or not state_value:
            raise LearningApiError("id_token and state are required", status_code=400)

        state = self.lti_state_store.pop(state_value)
        claims = self.lti_verifier.verify(id_token)
        if claims.iss != state.issuer or claims.nonce != state.nonce:
            raise LTIValidationError("LTI state mismatch")
        if state.deployment_id and claims.deployment_id != state.deployment_id:
            raise LTIValidationError("LTI deployment mismatch")

        tenant_id = claims.context.label or PILOT_TENANT_ID
        class_id = claims.context.id
        student_id = claims.sub
        role = "teacher" if any("Instructor" in role_uri for role_uri in claims.roles) else "learner"

        event = LTILaunchEvent(
            tenant_id=tenant_id,
            actor_id=student_id,
            class_id=class_id,
            role=role,
            issuer=claims.iss,
            deployment_id=claims.deployment_id,
            resource_link_id=claims.resource_link.id,
            lang="en",
            provenance=[
                Provenance(
                    source="LearningApi.complete_lti_launch",
                    source_id=claims.deployment_id,
                    rule_id="lti_1p3_resource_link_launch",
                    confidence=1.0,
                    evidence_count=1,
                    metadata={"issuer": claims.iss, "resource_link_id": claims.resource_link.id},
                )
            ],
        )
        statement = lti_launch_event_to_xapi(event)
        self._emit_xapi(tenant_id, student_id, statement)
        self._record_audit(
            tenant_id=tenant_id,
            actor_id=student_id,
            label=f"LTI launch for {class_id}/{student_id}",
            kind="lti_launch",
        )
        session_token = self._encode_lti_session(
            tenant_id=tenant_id,
            class_id=class_id,
            student_id=student_id,
            role=role,
        )
        return f"/learning/launch?session={session_token}"

    def _encode_lti_session(self, *, tenant_id: str, class_id: str, student_id: str, role: str) -> str:
        if not self.lti_session_secret:
            raise LearningApiError("LTI_SESSION_SECRET is not configured", status_code=500)
        return jwt.encode(
            {
                "tenant_id": tenant_id,
                "class_id": class_id,
                "student_id": student_id,
                "role": role,
                "exp": session_expiry_timestamp(900),
            },
            self.lti_session_secret,
            algorithm="HS256",
        )

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

    def get_observability_config(self, _payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self.observability.config_payload()

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
    # Skills catalogue (Workstream B)
    # ------------------------------------------------------------------
    def list_skills(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        query = payload.get("query")
        subject = payload.get("subject")
        status = str(payload.get("status") or "active")
        try:
            limit = int(payload.get("limit") or 50)
            offset = int(payload.get("offset") or 0)
        except (TypeError, ValueError) as exc:
            raise LearningApiError(f"invalid pagination: {exc}", status_code=400) from exc
        try:
            result = self.repository.list_skills(
                tenant_id,
                query=str(query) if query else None,
                subject=str(subject) if subject else None,
                status=status,
                limit=limit,
                offset=offset,
            )
        except ValueError as exc:
            raise LearningApiError(str(exc), status_code=400) from exc
        return result.model_dump()

    def get_skill(self, skill_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        skill = self.repository.get_skill(tenant_id, skill_id)
        if skill is None:
            raise LearningApiError(f"skill not found: {skill_id}", status_code=404)
        return skill.model_dump()

    def create_skill(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        body = dict(payload)
        body.setdefault("tenant_id", PILOT_TENANT_ID)
        if not body.get("provenance"):
            body["provenance"] = [
                {
                    "source": "LearningApi.create_skill",
                    "rule_id": "operator_provided",
                    "confidence": 1.0,
                    "evidence_count": 1,
                }
            ]
        try:
            skill = CatalogueSkill.model_validate(body)
        except Exception as exc:  # pydantic.ValidationError
            raise LearningApiError(f"invalid skill payload: {exc}", status_code=400) from exc
        try:
            created = self.skills_service.create(skill)
        except SkillCatalogueError as exc:
            raise LearningApiError(str(exc), status_code=409) from exc
        return created.model_dump()

    def archive_skill(self, skill_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        archived = self.skills_service.archive(tenant_id, skill_id)
        if archived is None:
            raise LearningApiError(f"skill not found: {skill_id}", status_code=404)
        return archived.model_dump()

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

    def ask_assistant(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Unified Ask Pathfinder entrypoint — text in, deterministic answer out.

        Accepts the learner's local context (weak_topics, daily_plan,
        career_fits, last_wrong_answer) so phase 1 can quote it back without
        round-tripping to storage. Phase 2 will switch the provider to a
        model-backed one (see ``/memories/repo/pathfinder-ask-assistant-phase2.md``).
        """
        question = str(payload.get("question") or "").strip()
        if not question:
            raise LearningApiError("question is required", status_code=400)
        context: Dict[str, Any] = {
            "user_id": payload.get("user_id"),
            "weak_topics": payload.get("weak_topics") or [],
            "daily_plan": payload.get("daily_plan") or [],
            "career_fits": payload.get("career_fits") or [],
            "last_wrong_answer": payload.get("last_wrong_answer") or {},
            "learner_setup": payload.get("learner_setup") or {},
        }
        reply = self.assistant_provider.ask(question, context)
        return {
            "answer": str(reply.get("answer", "")),
            "citations": list(reply.get("citations") or []),
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

    def run_learner_voice_turn(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Drive the learner fullscreen voice + gen-UI surface.

        Stateless: client sends the prior card id/kind plus any answer,
        the planner returns the next card. ``child_id`` is required so
        the realtime transport can RLS-scope reads in phase 2.1.
        """
        try:
            request_model = LearnerVoiceTurnRequest(
                child_id=str(payload.get("child_id") or "").strip(),
                lang=str(payload.get("lang") or "en-NG"),
                last_card_id=payload.get("last_card_id"),
                last_kind=payload.get("last_kind"),
                answer_option_id=payload.get("answer_option_id"),
                advance=bool(payload.get("advance") or False),
                exam=payload.get("exam"),
                class_year=payload.get("class_year"),
                subject=payload.get("subject"),
            )
        except Exception as exc:  # pydantic validation
            raise LearningApiError(f"invalid voice turn: {exc}", status_code=400) from exc
        response = self.learner_voice_planner.next_turn(request_model)
        return response.model_dump()

    def build_learner_plan(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Return an adaptive, mastery-ranked daily plan for one learner.

        The queue is ranked from the learner's persisted ``MasteryEvent``
        history (weakest skills first). Learners with no history get a
        deterministic WAEC / SSS2 / Mathematics walk (``source="fallback"``).
        ``student_id`` is required and is expected to have been ownership-checked
        by the route's RBAC guard before this method runs.
        """
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        student_id = str(payload.get("student_id") or "").strip()
        if not student_id:
            raise LearningApiError("student_id is required", status_code=400)

        exam = str(payload.get("exam") or "").strip() or None
        class_year = str(payload.get("class_year") or "").strip() or None
        subject = str(payload.get("subject") or "").strip() or None

        # 1. Latest mastery estimate per skill. Persisted events are returned
        #    newest-first, so the first occurrence of each skill wins; the
        #    process-local cache backfills a just-completed diagnostic.
        estimates_by_skill: Dict[str, MasteryEstimate] = {}
        try:
            events = self.repository.list_mastery_events_for_student(
                tenant_id, student_id, limit=200
            )
        except Exception:  # noqa: BLE001 - degrade to fallback on storage errors
            events = []
        for record in events:
            skill_id = str(record.get("skill_id") or "")
            if not skill_id or skill_id in estimates_by_skill:
                continue
            raw_estimate = record.get("estimate")
            if not isinstance(raw_estimate, Mapping):
                continue
            try:
                estimates_by_skill[skill_id] = MasteryEstimate(**dict(raw_estimate))
            except Exception:  # noqa: BLE001 - skip malformed rows
                continue
        for skill_id, estimate in self._student_estimates.get(
            (tenant_id, student_id), {}
        ).items():
            estimates_by_skill.setdefault(skill_id, estimate)

        has_history = bool(estimates_by_skill)
        source = "mastery" if has_history else "fallback"

        # 2. Resolve the content taxonomy from the learner's profile slots,
        #    filling any gaps from the deterministic default. ``source`` tracks
        #    whether the *ranking* used real mastery history, independently of
        #    which taxonomy supplies the content.
        planner = self.learner_voice_planner
        r_exam, r_class, r_subject = planner.resolve_taxonomy(
            exam=exam, class_year=class_year, subject=subject
        )
        cards = planner.candidate_cards(
            exam=r_exam, class_year=r_class, subject=r_subject
        )
        if not cards:
            r_exam, r_class, r_subject = planner.default_taxonomy()
            cards = planner.candidate_cards(
                exam=r_exam, class_year=r_class, subject=r_subject
            )

        skill_labels = self._skill_label_lookup()

        # 3. Rank weakest skills (lowest probability first, then by id).
        ranked = sorted(
            estimates_by_skill.items(),
            key=lambda kv: (kv[1].probability, kv[0]),
        )
        weak_topics: List[LearnerWeakTopic] = []
        for skill_id, estimate in ranked[:3]:
            status = heatmap_status(estimate)
            weak_topics.append(
                LearnerWeakTopic(
                    skill_id=skill_id,
                    label=skill_labels.get(skill_id) or _humanize_skill_id(skill_id),
                    mastery=int(round(estimate.probability * 100)),
                    gap=_WEAK_TOPIC_GAP[status],
                    next_action=_WEAK_TOPIC_ACTION[status],
                )
            )

        # 4. Order today's cards so the weakest-skill cards come first.
        weakness_rank = {
            skill_id: index for index, (skill_id, _est) in enumerate(ranked)
        }
        ordered_cards = sorted(
            cards,
            key=lambda card: weakness_rank.get(card.skill_id or "", len(weakness_rank) + 1),
        )[: planner.MAX_QUESTIONS]

        item_types: List[str] = ["check-in", "practice", "exit-ticket"]
        item_minutes = {"check-in": 5, "practice": 6, "exit-ticket": 3}
        today: List[LearnerDailyPlanItem] = []
        for index, card in enumerate(ordered_cards):
            kind = item_types[index] if index < len(item_types) else "practice"
            card_skill = card.skill_id or None
            label = (
                skill_labels.get(card_skill or "")
                or _humanize_skill_id(card_skill or "")
                if card_skill
                else "Practice"
            )
            today.append(
                LearnerDailyPlanItem(
                    id=f"plan-{index + 1}-{card_skill or 'item'}",
                    title=label,
                    meta=_truncate_text(card.stem, 90),
                    minutes=item_minutes[kind],
                    type=kind,  # type: ignore[arg-type]
                    skill_id=card_skill,
                    subject=r_subject.lower(),
                )
            )

        plan = LearnerDailyPlan(
            student_id=student_id,
            exam=r_exam,
            class_year=r_class,
            subject=r_subject,
            source=source,  # type: ignore[arg-type]
            generated_at=_utc_now_iso(),
            today=today,
            weak_topics=weak_topics,
        )
        return plan.model_dump()

    def _skill_label_lookup(self) -> Dict[str, str]:
        labels: Dict[str, str] = {}
        for bank in self._banks_by_id.values():
            for skill in bank.skills:
                labels.setdefault(skill.skill_id, skill.name)
        return labels

    def build_exam_prep_topics(self) -> Dict[str, Any]:
        """Return the full exam-prep topic catalogue grouped by subject.

        Topics are derived from every served diagnostic bank's skill list:
        each distinct ``(year, topic-area)`` becomes one practisable topic
        whose ``skill_id`` is the first catalogued skill in that area. This
        exposes the real breadth of the question banks (tens of topics per
        subject) instead of the static teaser list the client ships as an
        offline fallback. Each topic carries a ``diagnostic_subject`` /
        ``skill_id`` pair the client can replay through
        ``/api/learning/diagnostic/start``.
        """
        subjects: Dict[str, Dict[str, Any]] = {}
        for bank in self._banks_by_id.values():
            slug = _exam_prep_subject_slug(bank.subject)
            label = _exam_prep_title_case(slug)
            subject_entry = subjects.setdefault(
                slug, {"subject": slug, "label": label, "_topics": {}}
            )
            topics_by_key: Dict[Tuple[str, str], Dict[str, Any]] = subject_entry[
                "_topics"
            ]
            for skill in bank.skills:
                year, topic = _exam_prep_topic_parts(skill.skill_id)
                if not topic or year is None:
                    # Skip skills without a recognised year band (e.g. small
                    # phase-2 / pilot fixtures): the exam-prep catalogue only
                    # surfaces JSSCE / WAEC / NECO content.
                    continue
                key = (year or "", topic)
                entry = topics_by_key.get(key)
                if entry is None:
                    year_label, exam = _exam_prep_year_exam(year)
                    topic_label = _exam_prep_title_case(topic)
                    entry = {
                        "id": f"{slug}.{year or 'x'}.{topic}",
                        "title": f"{label} · {topic_label}",
                        "subject": slug,
                        "subject_label": label,
                        "topic": topic,
                        "topic_label": topic_label,
                        "year": year_label,
                        "exam": exam,
                        "skill_id": skill.skill_id,
                        "diagnostic_id": bank.diagnostic_id,
                        "diagnostic_subject": bank.subject or slug,
                        "skill_count": 0,
                        "minutes": 5 if exam == "JSSCE" else 6,
                    }
                    topics_by_key[key] = entry
                entry["skill_count"] += 1

        out_subjects: List[Dict[str, Any]] = []
        flat: List[Dict[str, Any]] = []
        for slug in sorted(subjects):
            subject_entry = subjects[slug]
            topics = sorted(
                subject_entry["_topics"].values(),
                key=lambda topic_entry: (topic_entry["year"], topic_entry["topic"]),
            )
            if not topics:
                continue
            out_subjects.append(
                {
                    "subject": subject_entry["subject"],
                    "label": subject_entry["label"],
                    "topic_count": len(topics),
                    "skill_count": sum(t["skill_count"] for t in topics),
                    "topics": topics,
                }
            )
            flat.extend(topics)
        return {
            "generated_at": _utc_now_iso(),
            "subject_count": len(out_subjects),
            "topic_count": len(flat),
            "subjects": out_subjects,
            "topics": flat,
        }

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
        record["class_id"] = state.class_id
        self._pending_plans[result.plan.plan_id] = record
        return record

    def _student_ids_for_class(self, tenant_id: str, class_id: str) -> List[str]:
        return list(
            sorted(
                student_id
                for (event_tenant, student_id) in self._student_estimates.keys()
                if event_tenant == tenant_id
                and self._student_classes.get((event_tenant, student_id), PILOT_CLASS_ID) == class_id
            )
        )

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
        payload_class_id = str(payload.get("class_id") or "").strip()
        record_class_id = str(record.get("class_id") or "").strip()
        if payload_class_id and record_class_id and payload_class_id != record_class_id:
            raise LearningApiError("plan is not in the requested class", status_code=403)
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
        self._emit_xapi(tenant_id, actor_id, statement)
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
    # W8 — Spaced-retrieval Web Push
    # ------------------------------------------------------------------
    def get_vapid_public_key(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "publicKey": self.vapid_config.public_key,
            "configured": self.vapid_config.configured,
        }

    def register_push_subscription(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        user_id = str(payload.get("user_id") or "").strip()
        sub_payload = payload.get("subscription") or {}
        if not isinstance(sub_payload, Mapping):
            raise LearningApiError("subscription must be an object", status_code=400)
        endpoint = str(sub_payload.get("endpoint") or "").strip()
        keys = sub_payload.get("keys") or {}
        if not isinstance(keys, Mapping):
            raise LearningApiError("subscription.keys must be an object", status_code=400)
        p256dh = str(keys.get("p256dh") or "").strip()
        auth = str(keys.get("auth") or "").strip()
        if not (user_id and endpoint and p256dh and auth):
            raise LearningApiError(
                "user_id and subscription.endpoint/keys.p256dh/keys.auth are required",
                status_code=400,
            )
        subscription = PushSubscription(
            id=str(uuid4()),
            tenant_id=tenant_id,
            user_id=user_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            user_agent=(payload.get("user_agent") or _request_user_agent()) or None,
        )
        stored = self.notifications_repository.upsert_subscription(subscription)
        return {
            "ok": True,
            "subscription_id": stored.id,
            "endpoint": stored.endpoint,
        }

    def schedule_revision_cards(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        user_id = str(payload.get("user_id") or "").strip()
        cards_in = payload.get("cards") or []
        if not user_id:
            raise LearningApiError("user_id is required", status_code=400)
        if not isinstance(cards_in, list) or not cards_in:
            raise LearningApiError("cards must be a non-empty array", status_code=400)
        cards: List[RevisionCard] = []
        for raw in cards_in:
            if not isinstance(raw, Mapping):
                raise LearningApiError("each card must be an object", status_code=400)
            topic_id = str(raw.get("topic_id") or "").strip()
            label = str(raw.get("label") or "").strip()
            due_at = str(raw.get("due_at") or "").strip()
            if not (topic_id and label and due_at):
                raise LearningApiError(
                    "card.topic_id, card.label, card.due_at are required",
                    status_code=400,
                )
            cards.append(
                RevisionCard(
                    id=str(uuid4()),
                    tenant_id=tenant_id,
                    user_id=user_id,
                    topic_id=topic_id,
                    label=label,
                    due_at=due_at,
                    payload=raw.get("payload") or {},
                )
            )
        stored = self.notifications_repository.schedule_cards(cards)
        return {
            "ok": True,
            "scheduled": len(stored),
            "card_ids": [c.id for c in stored],
        }

    def list_revision_cards(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
        user_id = str(payload.get("user_id") or "").strip()
        if not user_id:
            raise LearningApiError("user_id is required", status_code=400)
        rows = self.notifications_repository.list_user_cards(tenant_id, user_id)
        return {
            "cards": [
                {
                    "id": c.id,
                    "topic_id": c.topic_id,
                    "label": c.label,
                    "due_at": c.due_at,
                    "status": c.status,
                    "sent_at": c.sent_at,
                }
                for c in rows
            ]
        }

    # ------------------------------------------------------------------
    # Test helpers
    # ------------------------------------------------------------------
    def _reset_for_tests(self) -> None:
        with self._lock:
            self._sessions.clear()
            self._student_estimates.clear()
            self._student_classes.clear()
            self._pending_plans.clear()
            self._audit_events.clear()
        self.observability.reset_for_tests()


def _item_to_payload(item: DiagnosticItem) -> Dict[str, Any]:
    return {
        "item_id": item.item_id,
        "skill_id": item.skill_id,
        "prompt": item.prompt,
        "item_type": item.item_type,
        "difficulty": item.difficulty,
        "lang": item.lang,
    }


_WEAK_TOPIC_GAP: Dict[str, str] = {
    "needs_support": "This topic needs the most attention right now.",
    "developing": "You're getting there — a little more practice will lock it in.",
    "secure": "Mostly solid; a quick check keeps it sharp.",
}

_WEAK_TOPIC_ACTION: Dict[str, str] = {
    "needs_support": "Start with a worked example, then try two short questions.",
    "developing": "Answer three timed questions to build confidence.",
    "secure": "Do one quick retrieval question to stay fresh.",
}


def _humanize_skill_id(skill_id: str) -> str:
    cleaned = skill_id.replace("_", " ").replace(".", " ").replace("-", " ").strip()
    if not cleaned:
        return "Practice"
    return " ".join(part.capitalize() for part in cleaned.split())


# ---------------------------------------------------------------------------
# Exam-prep topic catalogue helpers
#
# Skill ids in the served diagnostic banks encode a taxonomy:
#   ``<year>.<subject?>.<topic-area>.<specific>`` (e.g.
#   ``ss3.physics.kinematics.speed_def``) or, for maths/english,
#   ``<year>.<topic-area>.<specific>`` (e.g. ``jss3.number.fractions``).
# The exam-prep library groups skills into one practisable topic per
# ``(year, topic-area)`` so the page reflects the real breadth of each bank.
# ---------------------------------------------------------------------------
_EXAM_PREP_YEAR_PREFIXES = frozenset(
    {"jss1", "jss2", "jss3", "ss1", "ss2", "ss3"}
)
_EXAM_PREP_SUBJECT_WORDS = frozenset(
    {
        "english",
        "mathematics",
        "maths",
        "physics",
        "biology",
        "chemistry",
        "government",
        "history",
        "literature",
        "economics",
        "agricultural_science",
        "computer_science",
        "data_processing",
        "ict",
        "basic_science",
        "social_studies",
    }
)
_EXAM_PREP_SUBJECT_SLUG_ALIASES = {"maths": "mathematics"}
_EXAM_PREP_SUBJECT_SUFFIXES = (
    "-jss3-ss3",
    "-jss2-ss3",
    "-jss3",
    "-jss2",
    "-ss3",
    "-ss2",
    "-ss1",
    "-ss",
)


def _exam_prep_title_case(value: str) -> str:
    cleaned = value.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return "General"
    return " ".join(part.capitalize() for part in cleaned.split())


def _exam_prep_subject_slug(bank_subject: Optional[str]) -> str:
    raw = (bank_subject or "general").strip().lower()
    for suffix in _EXAM_PREP_SUBJECT_SUFFIXES:
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]
            break
    slug = raw.replace("-", "_").strip("_")
    slug = _EXAM_PREP_SUBJECT_SLUG_ALIASES.get(slug, slug)
    return slug or "general"


def _exam_prep_topic_parts(skill_id: str) -> Tuple[Optional[str], Optional[str]]:
    parts = [part for part in skill_id.split(".") if part]
    if not parts:
        return None, None
    year: Optional[str] = parts[0] if parts[0] in _EXAM_PREP_YEAR_PREFIXES else None
    rest = parts[1:] if year else parts
    if len(rest) > 1 and rest[0] in _EXAM_PREP_SUBJECT_WORDS:
        rest = rest[1:]
    topic = rest[0] if rest else None
    return year, topic


def _exam_prep_year_exam(year: Optional[str]) -> Tuple[str, str]:
    if year and year.startswith("jss"):
        return year.upper(), "JSSCE"
    if year and year.startswith("ss"):
        return year.upper(), "WAEC/NECO"
    return "Other", "Other"


def _truncate_text(text: str, limit: int) -> str:
    collapsed = " ".join((text or "").split())
    if not collapsed:
        return "Practice question"
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: max(1, limit - 1)].rstrip() + "…"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request_user_agent() -> Optional[str]:
    try:
        return request.headers.get("User-Agent")
    except RuntimeError:
        return None


def _read_payload() -> Dict[str, Any]:
    if request.method == "GET":
        return {k: v for k, v in request.args.items()}
    if request.form:
        return {k: v for k, v in request.form.items()}
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
    if "learning_tts" not in app.blueprints:
        app.register_blueprint(create_learning_tts_blueprint())

    decision_actions = {
        "approve_plan": "approved",
        "reject_plan": "rejected",
        "edit_and_approve_plan": "edited_approved",
    }

    def _record_decision_metric(operation: str, outcome: str, result: Optional[Mapping[str, Any]] = None) -> None:
        action = str((result or {}).get("action") or decision_actions.get(operation) or "")
        if action:
            learning_api.observability.record_decision(action, outcome)

    def _wrap(handler):
        def view(*args, **kwargs):
            operation = handler.__name__.lstrip("_")
            span_attributes = {
                "learning.operation": operation,
                "http.method": request.method,
                "http.route": request.url_rule.rule if request.url_rule else "",
            }
            with learning_api.observability.start_span(
                f"pathfinder.learning.{operation}", span_attributes
            ) as span:
                try:
                    payload = _read_payload()
                    result = handler(*args, payload=payload, **kwargs)
                    learning_api.observability.record_request(operation, request.method, "success")
                    _record_decision_metric(operation, "success", result)
                    if span is not None:
                        span.set_attribute("http.status_code", 200)
                        span.set_attribute("learning.outcome", "success")
                    return jsonify(result)
                except LearningApiError as exc:
                    learning_api.observability.record_request(operation, request.method, "error")
                    _record_decision_metric(operation, "error")
                    if span is not None:
                        span.set_attribute("http.status_code", exc.status_code)
                        span.set_attribute("learning.outcome", "error")
                        span.record_exception(exc)
                    return jsonify({"error": str(exc)}), exc.status_code
                except Exception as exc:
                    learning_api.observability.record_request(operation, request.method, "error")
                    _record_decision_metric(operation, "error")
                    if span is not None:
                        span.set_attribute("learning.outcome", "error")
                        span.record_exception(exc)
                    raise

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

    @app.route("/api/learning/approvals/<plan_id>/edit-approve", methods=["POST"])
    @_wrap
    def _edit_and_approve_plan(plan_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.edit_and_approve_plan(plan_id, payload)

    @app.route("/api/learning/student-facts", methods=["GET"])
    @_wrap
    def _student_facts(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_student_facts(payload)

    @app.route("/api/learning/student-facts", methods=["POST"])
    @_wrap
    def _propose_student_fact(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.propose_student_fact(payload)

    @app.route("/api/learning/student-facts/pending", methods=["GET"])
    @_wrap
    def _pending_student_facts(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_student_facts({**payload, "status": "pending"})

    @app.route("/api/learning/student-facts/<fact_id>/approve", methods=["POST"])
    @_wrap
    def _approve_student_fact(fact_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.approve_student_fact(fact_id, payload)

    @app.route("/api/learning/student-facts/<fact_id>/reject", methods=["POST"])
    @_wrap
    def _reject_student_fact(fact_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.reject_student_fact(fact_id, payload)

    @app.route("/api/learning/student-facts/<fact_id>/edit-approve", methods=["POST"])
    @_wrap
    def _edit_and_approve_student_fact(fact_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.edit_and_approve_student_fact(fact_id, payload)

    @app.route("/api/learning/students/<student_id>/profile", methods=["GET"])
    @_wrap
    def _student_profile(student_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_student_profile(student_id, payload)

    @app.route("/api/learning/students/<student_id>/override", methods=["POST"])
    @_wrap
    def _student_override(student_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.override_mastery(student_id, payload)

    @app.route("/api/learning/lti/login", methods=["POST"])
    @_wrap
    def _lti_login(payload: Dict[str, Any]) -> Dict[str, str]:
        return learning_api.initiate_lti_login(payload)

    @app.route("/api/learning/lti/launch", methods=["POST"])
    def _lti_launch():
        operation = "lti_launch"
        with learning_api.observability.start_span(
            "pathfinder.learning.lti_launch",
            {
                "learning.operation": operation,
                "http.method": request.method,
                "http.route": request.url_rule.rule if request.url_rule else "",
            },
        ) as span:
            try:
                location = learning_api.complete_lti_launch(_read_payload())
                learning_api.observability.record_request(operation, request.method, "success")
                if span is not None:
                    span.set_attribute("http.status_code", 302)
                    span.set_attribute("learning.outcome", "success")
                return redirect(location, code=302)
            except LearningApiError as exc:
                learning_api.observability.record_request(operation, request.method, "error")
                if span is not None:
                    span.set_attribute("http.status_code", exc.status_code)
                    span.set_attribute("learning.outcome", "error")
                    span.record_exception(exc)
                return jsonify({"error": str(exc)}), exc.status_code

    @app.route("/api/learning/intent", methods=["POST"])
    @_wrap
    def _intent(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.submit_intent(payload)

    @app.route("/api/learning/explain", methods=["POST"])
    @_wrap
    def _explain(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.explain(payload)

    @app.route("/api/learning/audit", methods=["GET"])
    @_wrap
    def _audit(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_audit(payload)

    @app.route("/api/learning/kpis", methods=["GET"])
    @_wrap
    def _kpis(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_pilot_kpis(payload)

    @app.route("/api/learning/observability/config", methods=["GET"])
    @_wrap
    def _observability_config(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_observability_config(payload)

    @app.route("/api/learning/metrics", methods=["GET"])
    def _learning_metrics():
        if not learning_api.observability.prometheus_enabled:
            return jsonify({"error": "learning prometheus metrics disabled"}), 403
        body, content_type = learning_api.observability.render_prometheus()
        return Response(body, content_type=content_type)

    @app.route("/api/learning/voice/config", methods=["GET"])
    @_wrap
    def _voice_config(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_voice_config(payload)

    @app.route("/api/learning/voice/frame", methods=["POST"])
    @_wrap
    def _voice_frame(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.submit_voice_frame(payload)

    @app.route("/api/learning/voice/turn", methods=["POST"])
    @_wrap
    def _voice_turn(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.run_learner_voice_turn(payload)

    @app.route("/api/learning/assistant/ask", methods=["POST"])
    @_wrap
    def _ask_assistant(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.ask_assistant(payload)

    @app.route("/api/learning/subjects", methods=["GET"])
    @_wrap
    def _subjects(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_subjects(payload)

    @app.route("/api/learning/skills", methods=["GET"])
    @_wrap
    def _list_skills(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_skills(payload)

    @app.route("/api/learning/skills", methods=["POST"])
    @_wrap
    def _create_skill(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.create_skill(payload)

    @app.route("/api/learning/skills/<skill_id>", methods=["GET"])
    @_wrap
    def _get_skill(skill_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_skill(skill_id, payload)

    @app.route("/api/learning/skills/<skill_id>/archive", methods=["POST"])
    @_wrap
    def _archive_skill(skill_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.archive_skill(skill_id, payload)

    @app.route("/api/learning/notifications/push/vapid-public-key", methods=["GET"])
    @_wrap
    def _vapid_public_key(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.get_vapid_public_key(payload)

    @app.route("/api/learning/notifications/push/subscribe", methods=["POST"])
    @_wrap
    def _push_subscribe(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.register_push_subscription(payload)

    @app.route("/api/learning/notifications/revision-cards/schedule", methods=["POST"])
    @_wrap
    def _schedule_revision_cards(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.schedule_revision_cards(payload)

    @app.route("/api/learning/notifications/revision-cards", methods=["GET"])
    @_wrap
    def _list_revision_cards(payload: Dict[str, Any]) -> Dict[str, Any]:
        return learning_api.list_revision_cards(payload)

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
