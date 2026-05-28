"""Pydantic contracts for the Pathfinder Learn bounded context."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


LANGUAGE_TAG_PATTERN = r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"


class ContractModel(BaseModel):
    """Base model for strict, assignment-validated contracts."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Provenance(ContractModel):
    """Source metadata carried by every model output."""

    source: str = Field(min_length=1)
    source_id: Optional[str] = None
    rule_id: Optional[str] = None
    recency: Optional[str] = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    evidence_count: int = Field(default=1, ge=0)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LanguageAndProvenanceModel(ContractModel):
    """Base for planner outputs and persisted learning events."""

    lang: str = Field(pattern=LANGUAGE_TAG_PATTERN)
    provenance: List[Provenance] = Field(min_length=1)


class Student(ContractModel):
    student_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    class_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    year_group: Optional[str] = None
    career_consent: bool = False


class Teacher(ContractModel):
    teacher_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    class_ids: List[str] = Field(default_factory=list)


class Class(ContractModel):
    class_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    year_group: str = Field(min_length=1)


class Cohort(ContractModel):
    cohort_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    class_ids: List[str] = Field(default_factory=list)


class Skill(ContractModel):
    skill_id: str = Field(min_length=1)
    standard_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: Optional[str] = None


class Standard(ContractModel):
    standard_id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class DiagnosticItem(LanguageAndProvenanceModel):
    item_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    item_type: str = Field(min_length=1)
    difficulty: float = Field(default=0.0, ge=-5.0, le=5.0)
    correct_answer: Optional[str] = None
    # MVP §4.2 — misconception taxonomy + question schema extension (W1).
    # All new fields are optional to keep wire compatibility with existing
    # fixtures; cross-field rules below enforce the taxonomy contract when
    # any of them are populated.
    subject: Optional[Literal["maths", "english"]] = None
    year_group: Optional[Literal["JSS3", "SS3"]] = None
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    misconception_codes: List[str] = Field(default_factory=list)
    taxonomy_version: Optional[str] = None

    @field_validator("misconception_codes")
    @classmethod
    def _validate_misconception_codes(cls, codes: List[str]) -> List[str]:
        # Imported lazily to avoid an import cycle (misconceptions imports
        # ContractModel from this module).
        from src.learning.misconceptions import MisconceptionCode

        allowed = {member.value for member in MisconceptionCode}
        seen: set[str] = set()
        for code in codes:
            if code not in allowed:
                raise ValueError(f"unknown misconception code: {code}")
            if code in seen:
                raise ValueError(f"duplicate misconception code: {code}")
            seen.add(code)
        return codes

    @model_validator(mode="after")
    def _require_taxonomy_version_when_tagged(self) -> "DiagnosticItem":
        from src.learning.misconceptions import TAXONOMY_VERSION

        if self.misconception_codes and not self.taxonomy_version:
            raise ValueError(
                "taxonomy_version is required when misconception_codes is non-empty"
            )
        if self.taxonomy_version and self.taxonomy_version != TAXONOMY_VERSION:
            raise ValueError(
                f"taxonomy_version {self.taxonomy_version!r} does not match "
                f"current {TAXONOMY_VERSION!r}"
            )
        if self.topic is not None and not self.topic.strip():
            raise ValueError("topic must be non-blank when present")
        if self.subtopic is not None and not self.subtopic.strip():
            raise ValueError("subtopic must be non-blank when present")
        return self


class StudentResponse(LanguageAndProvenanceModel):
    response_id: str = Field(default_factory=lambda: f"response-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    response_text: str = Field(min_length=1)
    correct: bool


class MasteryEstimate(ContractModel):
    kind: Literal["beta", "elo"]
    probability: float = Field(ge=0.0, le=1.0)
    uncertainty: float = Field(ge=0.0, le=1.0)
    a: Optional[float] = Field(default=None, gt=0.0)
    b: Optional[float] = Field(default=None, gt=0.0)
    rating: Optional[float] = None
    deviation: Optional[float] = Field(default=None, ge=0.0)

    @model_validator(mode="after")
    def require_estimator_fields(self) -> "MasteryEstimate":
        if self.kind == "beta" and (self.a is None or self.b is None):
            raise ValueError("beta mastery estimates require a and b")
        if self.kind == "elo" and self.rating is None:
            raise ValueError("elo mastery estimates require rating")
        return self


class MasteryEvent(LanguageAndProvenanceModel):
    event_id: str = Field(default_factory=lambda: f"mastery-event-{uuid4().hex[:12]}")
    event_type: Literal["mastery_event"] = "mastery_event"
    tenant_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    response_id: str = Field(min_length=1)
    estimate: MasteryEstimate


class InterventionPlan(LanguageAndProvenanceModel):
    plan_id: str = Field(default_factory=lambda: f"intervention-plan-{uuid4().hex[:12]}")
    parent_plan_id: Optional[str] = None
    target_skill_ids: List[str] = Field(min_length=1)
    target_student_ids: List[str] = Field(min_length=1)
    item_types: List[str] = Field(min_length=1)
    suggested_resources: List[str] = Field(default_factory=list)
    rationale: str = Field(min_length=1)
    requires_approval: bool = True

    @field_validator("target_skill_ids", "target_student_ids", "item_types")
    @classmethod
    def reject_blank_items(cls, values: List[str]) -> List[str]:
        if any(not str(value).strip() for value in values):
            raise ValueError("blank identifiers are not allowed")
        return values


class StudentFactProposal(LanguageAndProvenanceModel):
    fact_id: str = Field(default_factory=lambda: f"student-fact-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    class_id: str = Field(min_length=1)
    student_id: str = Field(min_length=1)
    student_name: Optional[str] = None
    key: str = Field(min_length=1)
    value: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    requires_approval: bool = True


class StudentLearningEvidence(ContractModel):
    source: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    skill_id: Optional[str] = None
    item_id: Optional[str] = None
    correct: Optional[bool] = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class StudentLearningInsight(ContractModel):
    skill_id: str = Field(min_length=1)
    skill_label: str = Field(min_length=1)
    probability: float = Field(ge=0.0, le=1.0)
    uncertainty: float = Field(ge=0.0, le=1.0)
    status: Literal["secure", "developing", "needs_support"]
    evidence: List[StudentLearningEvidence] = Field(min_length=1)


class VoiceFluencyResult(LanguageAndProvenanceModel):
    status: Literal["available", "not_recorded"]
    score: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    label: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    captured_at: Optional[str] = None


class LabourMarketSignal(ContractModel):
    source: str = Field(min_length=1)
    recency: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    value: Dict[str, Any]


class CareerPathway(ContractModel):
    pathway_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    fit_score: float = Field(ge=0.0, le=1.0)
    wage_band: LabourMarketSignal
    demand_trend: LabourMarketSignal
    rationale: str = Field(min_length=1)


class CareerPlan(LanguageAndProvenanceModel):
    plan_id: str = Field(default_factory=lambda: f"career-plan-{uuid4().hex[:12]}")
    student_id: str = Field(min_length=1)
    pathways: List[CareerPathway] = Field(min_length=1)
    requires_counsellor_signoff: bool = True


class ContentPackManifest(LanguageAndProvenanceModel):
    manifest_id: str = Field(default_factory=lambda: f"content-pack-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    pack_key: str = Field(min_length=1)
    version: str = Field(min_length=1)
    source_uri: str = Field(min_length=1)
    sha256: str = Field(min_length=64, max_length=64)
    payload: Dict[str, Any] = Field(default_factory=dict)


class OfflineQueuedEvent(ContractModel):
    queue_id: str = Field(default_factory=lambda: f"offline-queue-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    payload: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["queued", "replayed", "failed", "manual_review"] = "queued"


# ---------------------------------------------------------------------------
# Phase 1 — Workstream B1: Skills catalogue
# ---------------------------------------------------------------------------


class CatalogueSkill(LanguageAndProvenanceModel):
    """A curriculum-mapped skill exposed by the teacher-facing skills library.

    Extends the lightweight :class:`Skill` with the catalogue attributes
    required for browse/search, hierarchy traversal, and KS/KC mapping. The
    primary key remains ``skill_id`` so it stays interchangeable with
    :class:`Skill` at the API boundary.
    """

    skill_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    standard_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: Optional[str] = None
    subject: Optional[str] = None
    parent_skill_id: Optional[str] = None
    prerequisites: List[str] = Field(default_factory=list)
    kc_tags: List[str] = Field(default_factory=list)
    localisations: Dict[str, str] = Field(default_factory=dict)
    year_group_min: Optional[int] = Field(default=None, ge=1, le=13)
    year_group_max: Optional[int] = Field(default=None, ge=1, le=13)
    status: Literal["active", "draft", "archived"] = "active"


class SkillSearchResult(LanguageAndProvenanceModel):
    """Paged search response returned by the skills library API."""

    tenant_id: str = Field(min_length=1)
    query: str = Field(default="")
    skills: List[CatalogueSkill] = Field(default_factory=list)
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=200)
    offset: int = Field(ge=0)


# ---------------------------------------------------------------------------
# W2 — RAG grounding contract for the Explanation surface
#
# MVP §4.1: "no citation, no answer."
# Every ExplanationResult carries provenance[] = [{wiki_node_id, version,
# anchor}] with min_length=1. If retrieval cannot ground the response the
# agent emits a RefusalCard("no_grounding") instead. CI lint and a runtime
# fail-closed validator both enforce this so that an explanation surface
# cannot ship without a citation.
# ---------------------------------------------------------------------------


class WikiAnchor(ContractModel):
    """Stable pointer into a wiki node (section/heading/paragraph id)."""

    node_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    anchor: str = Field(min_length=1)


class WikiNode(LanguageAndProvenanceModel):
    """A versioned, retrievable node in the Pathfinder explanation wiki."""

    node_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    title: str = Field(min_length=1)
    subject: Literal["maths", "english"]
    year_group: Optional[Literal["JSS3", "SS3"]] = None
    topic: str = Field(min_length=1)
    subtopic: Optional[str] = None
    misconception_codes: List[str] = Field(default_factory=list)
    body_markdown: str = Field(min_length=1)
    anchors: List[str] = Field(default_factory=list)
    status: Literal["draft", "review", "approved", "frozen", "archived"] = "draft"

    @field_validator("misconception_codes")
    @classmethod
    def _validate_codes(cls, codes: List[str]) -> List[str]:
        from src.learning.misconceptions import MisconceptionCode

        allowed = {m.value for m in MisconceptionCode}
        seen: set[str] = set()
        for code in codes:
            if code not in allowed:
                raise ValueError(f"unknown misconception code: {code}")
            if code in seen:
                raise ValueError(f"duplicate misconception code: {code}")
            seen.add(code)
        return codes

    @field_validator("anchors")
    @classmethod
    def _anchors_non_blank_unique(cls, anchors: List[str]) -> List[str]:
        seen: set[str] = set()
        for anchor in anchors:
            if not anchor or not anchor.strip():
                raise ValueError("anchors must be non-blank")
            if anchor in seen:
                raise ValueError(f"duplicate anchor: {anchor}")
            seen.add(anchor)
        return anchors


REFUSAL_REASONS = ("no_grounding", "safety_block", "out_of_scope", "rate_limited")


class RefusalCard(LanguageAndProvenanceModel):
    """Returned when the explanation agent cannot ground or proceed.

    The provenance still carries the *reason* source (e.g. retriever id,
    safety classifier id) so the audit ledger can reconstruct why no
    explanation was produced.
    """

    reason: Literal["no_grounding", "safety_block", "out_of_scope", "rate_limited"]
    learner_message: str = Field(min_length=1)
    detail: Optional[str] = None
    suggested_action: Optional[str] = None


class ExplanationResult(LanguageAndProvenanceModel):
    """Output of the explanation agent. Fail-closed on missing grounding.

    `provenance` is inherited from LanguageAndProvenanceModel and is already
    min_length=1; the additional `wiki_citations` list enforces the stronger
    contract that at least one citation points to a WikiAnchor.
    """

    explanation_id: str = Field(default_factory=lambda: f"explanation-{uuid4().hex[:12]}")
    explanation_version: str = Field(min_length=1)
    question_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    misconception_code: Optional[str] = None
    body_markdown: str = Field(min_length=1)
    wiki_citations: List[WikiAnchor] = Field(min_length=1)

    @field_validator("misconception_code")
    @classmethod
    def _validate_code(cls, code: Optional[str]) -> Optional[str]:
        if code is None:
            return code
        from src.learning.misconceptions import MisconceptionCode

        if code not in {m.value for m in MisconceptionCode}:
            raise ValueError(f"unknown misconception code: {code}")
        return code

    @model_validator(mode="after")
    def _require_grounding(self) -> "ExplanationResult":
        # Belt-and-braces: Pydantic already enforces min_length=1 on the
        # field, but we restate the contract here so the error message
        # matches the MVP rule verbatim ("no citation, no answer").
        if not self.wiki_citations:
            raise ValueError("no citation, no answer: wiki_citations must be non-empty")
        return self
