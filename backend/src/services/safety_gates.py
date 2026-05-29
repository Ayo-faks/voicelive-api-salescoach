"""MVP safety gates for Wulo Academy: kill switch, session caps, content
safeguarding gate, and consent enforcement.

These primitives are deliberately small and pure: they take inputs and
return decisions. Call sites (route handlers, websocket handler) are
responsible for translating a ``SafetyDecision`` into the appropriate
HTTP/WebSocket response so error shapes stay consistent with the rest
of the app.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Final, Iterable, Mapping, Optional

# ----- Env flags -----------------------------------------------------------

ENV_LEARNER_VOICE_KILL_SWITCH: Final[str] = "WULO_LEARNER_VOICE_DISABLED"
ENV_SESSION_TURN_CAP: Final[str] = "WULO_SESSION_TURN_CAP"
ENV_SESSION_TOKEN_CAP: Final[str] = "WULO_SESSION_TOKEN_CAP"
ENV_PRODUCTION_SAFEGUARDING_REQUIRED: Final[str] = "WULO_REQUIRE_REVIEWED_CONTENT"
ENV_ALLOW_UNREVIEWED_CONTENT: Final[str] = "WULO_ALLOW_UNREVIEWED_CONTENT"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    value = raw.strip().lower()
    if not value:
        return default
    return value in _TRUTHY


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return parsed if parsed >= 0 else default


# ----- Decision type -------------------------------------------------------

REASON_KILL_SWITCH: Final[str] = "learner_voice_disabled"
REASON_MISSING_CONSENT: Final[str] = "missing_consent"
REASON_TURN_CAP: Final[str] = "session_turn_cap_reached"
REASON_TOKEN_CAP: Final[str] = "session_token_cap_reached"
REASON_UNREVIEWED_CONTENT: Final[str] = "unreviewed_content_blocked"


@dataclass(frozen=True)
class SafetyDecision:
    allowed: bool
    reason: Optional[str] = None
    detail: Optional[str] = None

    @classmethod
    def allow(cls) -> "SafetyDecision":
        return cls(True)

    @classmethod
    def deny(cls, reason: str, detail: Optional[str] = None) -> "SafetyDecision":
        return cls(False, reason=reason, detail=detail)


# ----- Kill switch & caps --------------------------------------------------


def learner_voice_kill_switch_enabled() -> bool:
    """Global disable for all learner-facing voice/AI features."""
    return _flag(ENV_LEARNER_VOICE_KILL_SWITCH, default=False)


def session_turn_cap() -> int:
    """Hard cap on conversational turns per session. 0 disables the cap."""
    return _int_env(ENV_SESSION_TURN_CAP, default=0)


def session_token_cap() -> int:
    """Hard cap on total model tokens per session. 0 disables the cap."""
    return _int_env(ENV_SESSION_TOKEN_CAP, default=0)


def check_session_caps(*, turns_used: int, tokens_used: int) -> SafetyDecision:
    turn_cap = session_turn_cap()
    if turn_cap and turns_used >= turn_cap:
        return SafetyDecision.deny(
            REASON_TURN_CAP,
            detail=f"turns_used={turns_used} cap={turn_cap}",
        )
    token_cap = session_token_cap()
    if token_cap and tokens_used >= token_cap:
        return SafetyDecision.deny(
            REASON_TOKEN_CAP,
            detail=f"tokens_used={tokens_used} cap={token_cap}",
        )
    return SafetyDecision.allow()


# ----- Consent gate --------------------------------------------------------

# Minimum consent fields required before any child voice session, transcript
# write, or report export. Mirrors the parental consent fields stored by
# ``child_parental_consent`` in ``src/app.py`` so the gate stays in lockstep
# with what the API already persists.
REQUIRED_CHILD_CONSENT_FIELDS: Final[tuple[str, ...]] = (
    "privacy_accepted",
    "terms_accepted",
    "ai_notice_accepted",
    "personal_data_consent_accepted",
)

# Additional fields required specifically for live voice / special-category
# audio capture. Kept separate so non-voice flows (e.g. read-only progress
# views) can use the lighter gate.
REQUIRED_VOICE_CONSENT_FIELDS: Final[tuple[str, ...]] = (
    "special_category_consent_accepted",
    "parental_responsibility_confirmed",
)


def _missing_consent_fields(
    consent: Optional[Mapping[str, object]],
    required: Iterable[str],
) -> list[str]:
    if not consent:
        return list(required)
    missing: list[str] = []
    for field in required:
        value = consent.get(field)
        if not bool(value):
            missing.append(field)
    return missing


def check_child_data_consent(
    consent: Optional[Mapping[str, object]],
) -> SafetyDecision:
    """Gate for any operation that reads or writes child personal data."""
    missing = _missing_consent_fields(consent, REQUIRED_CHILD_CONSENT_FIELDS)
    if missing:
        return SafetyDecision.deny(
            REASON_MISSING_CONSENT,
            detail=",".join(missing),
        )
    return SafetyDecision.allow()


def check_voice_session_consent(
    consent: Optional[Mapping[str, object]],
) -> SafetyDecision:
    """Stricter gate for live voice sessions that capture child speech."""
    missing = _missing_consent_fields(
        consent,
        list(REQUIRED_CHILD_CONSENT_FIELDS) + list(REQUIRED_VOICE_CONSENT_FIELDS),
    )
    if missing:
        return SafetyDecision.deny(
            REASON_MISSING_CONSENT,
            detail=",".join(missing),
        )
    return SafetyDecision.allow()


# ----- Production safeguarding-content gate --------------------------------


def production_content_review_required() -> bool:
    """When true, any question/content served must be safeguarding-reviewed.

    Defaults true on hosted Azure environments (where
    ``IDENTITY_ENDPOINT`` / ``WEBSITE_SITE_NAME`` are present) unless
    explicitly overridden, so a misconfigured dev flag cannot
    accidentally serve unreviewed content in production.
    """
    if _flag(ENV_ALLOW_UNREVIEWED_CONTENT, default=False):
        return False
    if _flag(ENV_PRODUCTION_SAFEGUARDING_REQUIRED, default=False):
        return True
    hosted_markers = ("IDENTITY_ENDPOINT", "WEBSITE_SITE_NAME", "CONTAINER_APP_NAME")
    return any(os.environ.get(marker) for marker in hosted_markers)


def check_content_review(
    *,
    subject_lead_approved: Optional[bool],
    safeguarding_reviewed: Optional[bool],
) -> SafetyDecision:
    """Decide whether a content item may be served in the current env."""
    if not production_content_review_required():
        return SafetyDecision.allow()
    if subject_lead_approved and safeguarding_reviewed:
        return SafetyDecision.allow()
    missing = []
    if not subject_lead_approved:
        missing.append("subject_lead_approved")
    if not safeguarding_reviewed:
        missing.append("safeguarding_reviewed")
    return SafetyDecision.deny(
        REASON_UNREVIEWED_CONTENT,
        detail=",".join(missing) or "review_state_not_approved",
    )


# ----- Composite kill switch ----------------------------------------------


def check_learner_voice_available() -> SafetyDecision:
    """Top-level gate the frontend uses to disable voice surfaces."""
    if learner_voice_kill_switch_enabled():
        return SafetyDecision.deny(REASON_KILL_SWITCH)
    return SafetyDecision.allow()


def public_status_payload() -> Mapping[str, object]:
    """Shape safe to expose via ``/api/config`` for the frontend."""
    return {
        "learner_voice_disabled": learner_voice_kill_switch_enabled(),
        "session_turn_cap": session_turn_cap(),
        "session_token_cap": session_token_cap(),
        "production_content_review_required": production_content_review_required(),
    }
