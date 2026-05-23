"""xAPI contracts and emitters for Pathfinder Learn events."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Protocol
from uuid import uuid4

from pydantic import Field

from src.learning.models import ContractModel, LanguageAndProvenanceModel, MasteryEvent, Provenance


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


class RalphXAPISink:
    """Ralph-compatible sink with an offline queue for Phase 1 verification."""

    def __init__(self, endpoint: Optional[str] = None, offline: bool = True) -> None:
        self.endpoint = endpoint
        self.offline = offline
        self.emitted: List[XAPIStatement] = []
        self.sink_status = "ralph_queued" if offline else "ralph_synced"

    def emit(self, statement: XAPIStatement) -> XAPIStatement:
        validated = XAPIStatement.model_validate(statement.model_dump())
        self.emitted.append(validated)
        return validated
