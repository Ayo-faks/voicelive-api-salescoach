"""B2C learner memory policy: allowlist / denylist / ephemeral / safeguarding.

This module classifies a proposed `StudentFactProposal` into one of four
outcomes used by `LearningApi.propose_student_fact`:

- `auto_approve` — key is on the allowlist and the value passes denylist + safeguarding
  checks. Persistent unless the key is ephemeral, in which case `expires_at` is set.
- `deny_safeguarding` — value matches a safeguarding tripwire. The fact is never stored;
  the caller surfaces help resources to the learner.
- `deny_pii` — value contains third-party PII or other denylisted content. Silently dropped.
- `pending` — fallback: route through the existing teacher approval queue.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional


# Allowlist (persistent): facts the learner is allowed to teach the assistant
# about themselves. These are durable preferences/goals/schedule items.
ALLOWLIST_PERSISTENT: frozenset[str] = frozenset({
    "preferred_subject",
    "exam_target",
    "exam_board",
    "weak_topic",
    "strong_topic",
    "available_minutes_per_day",
    "study_window",
    "learning_style",
    "preferred_explanation_style",
    "school_name",
    "year_group",
    "key_stage",
    "goal",
})

# Allowlist (ephemeral): point-in-time emotional/state signals. Stored for a
# short window so the tutor can adapt today's lesson, then auto-expired.
ALLOWLIST_EPHEMERAL: frozenset[str] = frozenset({
    "mood",
    "confidence_level",
    "energy",
})

EPHEMERAL_TTL = timedelta(hours=72)

# Denylist keys: even if a key is later allowed, these are never auto-stored.
DENYLIST_KEYS: frozenset[str] = frozenset({
    "guardian_name",
    "parent_name",
    "sibling_name",
    "teacher_name",
    "friend_name",
    "address",
    "postcode",
    "phone",
    "email",
    "bank",
    "card_number",
    "diagnosis",
    "medication",
    "religion",
})

# Crude PII heuristics applied to the value (case-insensitive).
_PII_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # UK postcode
    re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b", re.IGNORECASE),
    # Email
    re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    # Long digit runs that look like a phone or card
    re.compile(r"\b\d{10,}\b"),
)

# Safeguarding tripwire. Keep this list small and obvious in v1; the production
# upgrade is to swap in Azure AI Content Safety behind a feature flag.
_SAFEGUARDING_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(rf"\b{phrase}\b", re.IGNORECASE)
    for phrase in (
        r"kill myself",
        r"killing myself",
        r"end my life",
        r"want to die",
        r"suicide",
        r"suicidal",
        r"self[\s\-]?harm",
        r"hurt myself",
        r"hurting myself",
        r"cut myself",
        r"starve myself",
        r"hate myself",
        r"abuse(d)?",
        r"hit(s|ting)? me",
        r"hurt(s|ing)? me",
        r"touched me",
    )
)


Decision = Literal["auto_approve", "deny_safeguarding", "deny_pii", "pending"]


@dataclass(frozen=True)
class Classification:
    decision: Decision
    expires_at: Optional[str] = None  # ISO-8601 UTC when ephemeral
    reason: Optional[str] = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_safeguarding(text: str) -> bool:
    """True if the text contains a safeguarding tripwire phrase."""
    if not text:
        return False
    return any(pat.search(text) for pat in _SAFEGUARDING_PATTERNS)


def _looks_like_pii(value: str) -> bool:
    if not value:
        return False
    return any(pat.search(value) for pat in _PII_VALUE_PATTERNS)


def classify(key: str, value: str, *, now: Optional[datetime] = None) -> Classification:
    """Classify a proposed fact for auto-approve eligibility.

    The safeguarding check is run against both the key and value because the value
    is the learner-authored content; the key is normally a fixed enum but we still
    scan defensively.
    """
    key_norm = (key or "").strip().lower()
    value_str = (value or "").strip()
    combined = f"{key_norm} {value_str}"

    if is_safeguarding(combined):
        return Classification(decision="deny_safeguarding", reason="safeguarding_match")

    if key_norm in DENYLIST_KEYS or _looks_like_pii(value_str):
        return Classification(decision="deny_pii", reason="denylist_or_pii")

    if key_norm in ALLOWLIST_PERSISTENT:
        return Classification(decision="auto_approve")

    if key_norm in ALLOWLIST_EPHEMERAL:
        moment = now or _utcnow()
        return Classification(
            decision="auto_approve",
            expires_at=(moment + EPHEMERAL_TTL).isoformat(),
        )

    return Classification(decision="pending")


SAFEGUARDING_HELP_RESOURCES: tuple[dict, ...] = (
    {"label": "Samaritans (UK, 24/7)", "phone": "116 123", "url": "https://www.samaritans.org"},
    {"label": "Childline (UK, under 19)", "phone": "0800 1111", "url": "https://www.childline.org.uk"},
    {"label": "Shout (text UK)", "phone": "Text 85258", "url": "https://giveusashout.org"},
)
