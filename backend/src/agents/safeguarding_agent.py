"""SafeguardingAgent — read-only verdict layer over existing safety seams.

This agent is the mesh's veto authority for child-facing and
safety-sensitive actions. In Phase 1 it is **purely advisory and
read-only**: it never mutates state, never performs network I/O beyond what
the wrapped primitives already do, and never raises for a denied action — it
always returns a :class:`SafeguardingVerdict`. Call sites decide whether a
veto becomes an HTTP 403, a blocked tool, or a human-approval prompt.

It wraps primitives that already exist in the repo so it stays in lockstep
with the real enforcement code:

* child access  -> ``storage_service.user_has_child_access`` + role check
  (the same checks ``app._require_child_access`` performs)
* data / voice consent -> ``services.safety_gates.check_child_data_consent``
  / ``check_voice_session_consent``
* session caps + kill switch + content review -> ``services.safety_gates``
* transcript PII -> ``services.transcript_safety.redact_transcript``

Deliberately, the agent owns no new policy: every decision traces back to an
existing primitive. That is what makes it safe to introduce with zero
behaviour change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence

from src.agents.base import MeshAgent
from src.services import safety_gates, transcript_safety
from src.services.storage import ROLE_ADMIN, ROLE_THERAPIST

# Verdict reason codes (stable strings for logs / dashboards).
REASON_OK = "ok"
REASON_NOT_AUTHENTICATED = "not_authenticated"
REASON_ROLE_FORBIDDEN = "role_forbidden"
REASON_CHILD_ACCESS_DENIED = "child_access_denied"
REASON_MISSING_CONSENT = "missing_consent"
REASON_KILL_SWITCH = "learner_voice_disabled"
REASON_SESSION_CAP = "session_cap_reached"
REASON_UNREVIEWED_CONTENT = "unreviewed_content_blocked"
REASON_TRANSCRIPT_PII = "transcript_pii_detected"
REASON_UNKNOWN_ACTION = "unknown_action"


@dataclass(frozen=True)
class SafeguardingVerdict:
    """Outcome of a safeguarding assessment.

    ``allowed`` is the single boolean call sites branch on. ``vetoed`` is its
    inverse, provided for readability at veto sites. ``reason`` is a stable
    code; ``detail`` is a human-readable elaboration; ``signals`` carries any
    structured evidence (e.g. missing consent fields, PII counts).
    """

    allowed: bool
    reason: str = REASON_OK
    detail: Optional[str] = None
    signals: Mapping[str, Any] = field(default_factory=dict)

    @property
    def vetoed(self) -> bool:
        return not self.allowed

    @classmethod
    def allow(
        cls,
        reason: str = REASON_OK,
        *,
        detail: Optional[str] = None,
        signals: Optional[Mapping[str, Any]] = None,
    ) -> "SafeguardingVerdict":
        return cls(True, reason, detail, dict(signals or {}))

    @classmethod
    def veto(
        cls,
        reason: str,
        *,
        detail: Optional[str] = None,
        signals: Optional[Mapping[str, Any]] = None,
    ) -> "SafeguardingVerdict":
        return cls(False, reason, detail, dict(signals or {}))


_SAFEGUARDING_TOOLS = (
    "check_child_access",
    "check_data_consent",
    "check_voice_consent",
    "check_session_caps",
    "check_content_review",
    "inspect_transcript",
)


class SafeguardingAgent(MeshAgent):
    """Read-only veto authority over child-facing / safety-sensitive actions."""

    name = "safeguarding-agent"

    def __init__(
        self,
        storage_service: Any,
        *,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        super().__init__(
            allowed_tools=_SAFEGUARDING_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        self.storage_service = storage_service

    # -- Individual read-only checks (mesh "tools") --------------------

    def check_child_access(
        self,
        *,
        user: Optional[Mapping[str, Any]],
        child_id: str,
        allowed_roles: Optional[Sequence[str]] = None,
        allowed_relationships: Optional[Sequence[str]] = None,
        include_deleted: bool = False,
    ) -> SafeguardingVerdict:
        """Mirror ``app._require_child_access`` as a non-raising verdict."""
        self.ensure_tool_allowed("check_child_access")
        if not user:
            return SafeguardingVerdict.veto(REASON_NOT_AUTHENTICATED)

        role = str(user.get("role") or "")
        if allowed_roles is not None and role not in set(allowed_roles):
            return SafeguardingVerdict.veto(
                REASON_ROLE_FORBIDDEN,
                detail=f"role={role!r} not in {sorted(set(allowed_roles))}",
            )

        has_access = self.storage_service.user_has_child_access(
            str(user.get("id")),
            child_id,
            allowed_relationships=(
                list(allowed_relationships)
                if allowed_relationships is not None
                else None
            ),
            include_deleted=include_deleted,
        )
        if not has_access:
            return SafeguardingVerdict.veto(
                REASON_CHILD_ACCESS_DENIED,
                detail=f"user={user.get('id')} child={child_id}",
            )
        return SafeguardingVerdict.allow()

    def check_data_consent(
        self, consent: Optional[Mapping[str, Any]]
    ) -> SafeguardingVerdict:
        self.ensure_tool_allowed("check_data_consent")
        decision = safety_gates.check_child_data_consent(consent)
        return _from_safety_decision(decision, missing_kind="data_consent")

    def check_voice_consent(
        self, consent: Optional[Mapping[str, Any]]
    ) -> SafeguardingVerdict:
        self.ensure_tool_allowed("check_voice_consent")
        decision = safety_gates.check_voice_session_consent(consent)
        return _from_safety_decision(decision, missing_kind="voice_consent")

    def check_session_caps(
        self, *, turns_used: int, tokens_used: int
    ) -> SafeguardingVerdict:
        self.ensure_tool_allowed("check_session_caps")
        if safety_gates.learner_voice_kill_switch_enabled():
            return SafeguardingVerdict.veto(REASON_KILL_SWITCH)
        decision = safety_gates.check_session_caps(
            turns_used=turns_used, tokens_used=tokens_used
        )
        if not decision.allowed:
            return SafeguardingVerdict.veto(
                REASON_SESSION_CAP,
                detail=decision.detail,
                signals={"gate_reason": decision.reason},
            )
        return SafeguardingVerdict.allow()

    def check_content_review(
        self,
        *,
        subject_lead_approved: Optional[bool],
        safeguarding_reviewed: Optional[bool],
    ) -> SafeguardingVerdict:
        self.ensure_tool_allowed("check_content_review")
        decision = safety_gates.check_content_review(
            subject_lead_approved=subject_lead_approved,
            safeguarding_reviewed=safeguarding_reviewed,
        )
        if not decision.allowed:
            return SafeguardingVerdict.veto(
                REASON_UNREVIEWED_CONTENT,
                detail=decision.detail,
            )
        return SafeguardingVerdict.allow()

    def inspect_transcript(
        self,
        text: Optional[str],
        *,
        name_hints: Sequence[str] = (),
        guardian_hints: Sequence[str] = (),
    ) -> SafeguardingVerdict:
        """Veto if a transcript still carries detectable PII.

        Read-only: returns a verdict plus the redaction counts. The caller is
        responsible for persisting only ``report.redacted_text`` — the agent
        never writes anything.
        """
        self.ensure_tool_allowed("inspect_transcript")
        report = transcript_safety.redact_transcript(
            text,
            name_hints=tuple(name_hints),
            guardian_hints=tuple(guardian_hints),
        )
        if report.is_clean:
            return SafeguardingVerdict.allow(signals={"counts": dict(report.counts)})
        return SafeguardingVerdict.veto(
            REASON_TRANSCRIPT_PII,
            detail=",".join(sorted(report.counts)),
            signals={"counts": dict(report.counts)},
        )

    # -- Unified entry point -------------------------------------------

    def assess(self, action: Mapping[str, Any]) -> SafeguardingVerdict:
        """Dispatch an action descriptor to the matching read-only check.

        ``action`` is a mapping with a ``kind`` discriminator and the
        kwargs the corresponding check expects. Unknown kinds **fail closed**
        (vetoed), never silently allowed.
        """
        kind = str(action.get("kind") or "")
        verdict = self._dispatch(kind, action)
        self.log(
            "assess",
            kind=kind or None,
            allowed=verdict.allowed,
            reason=verdict.reason,
        )
        return verdict

    def _dispatch(
        self, kind: str, action: Mapping[str, Any]
    ) -> SafeguardingVerdict:
        if kind == "child_access":
            return self.check_child_access(
                user=action.get("user"),
                child_id=str(action.get("child_id") or ""),
                allowed_roles=action.get("allowed_roles"),
                allowed_relationships=action.get("allowed_relationships"),
                include_deleted=bool(action.get("include_deleted", False)),
            )
        if kind == "data_consent":
            return self.check_data_consent(action.get("consent"))
        if kind == "voice_consent":
            return self.check_voice_consent(action.get("consent"))
        if kind == "session_caps":
            return self.check_session_caps(
                turns_used=int(action.get("turns_used") or 0),
                tokens_used=int(action.get("tokens_used") or 0),
            )
        if kind == "content_review":
            return self.check_content_review(
                subject_lead_approved=action.get("subject_lead_approved"),
                safeguarding_reviewed=action.get("safeguarding_reviewed"),
            )
        if kind == "transcript":
            return self.inspect_transcript(
                action.get("text"),
                name_hints=tuple(action.get("name_hints") or ()),
                guardian_hints=tuple(action.get("guardian_hints") or ()),
            )
        return SafeguardingVerdict.veto(
            REASON_UNKNOWN_ACTION,
            detail=f"kind={kind!r}",
        )


def _from_safety_decision(
    decision: "safety_gates.SafetyDecision", *, missing_kind: str
) -> SafeguardingVerdict:
    if decision.allowed:
        return SafeguardingVerdict.allow()
    missing = [part for part in str(decision.detail or "").split(",") if part]
    return SafeguardingVerdict.veto(
        REASON_MISSING_CONSENT,
        detail=decision.detail,
        signals={"kind": missing_kind, "missing_fields": missing},
    )


# Roles that may access a child via the therapist console, exported for call
# sites that previously hard-coded the set inline.
DEFAULT_THERAPIST_CHILD_ROLES = (ROLE_THERAPIST, ROLE_ADMIN)
