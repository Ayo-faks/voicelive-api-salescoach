"""Episodic misconception memory: consent-gated cross-session trap recall.

Phase 5 of the grounded learner tutor. Wrong-attempt records carry a
misconception tag, the topic/skill they happened on, and a timestamp. This module
turns a learner's recent attempt history into:

- ``summarise_traps`` — ranked recurring misconception *traps* (a code that has
  caught the learner more than once inside the lookback window), ordered by
  frequency then recency.
- ``build_memory_callback`` — a single natural-language cross-session callback the
  tutor prompt can surface ("the sign-error trap caught you twice on Algebra
  recently — let's keep an eye on it"). **Consent-gated**: returns ``None`` unless
  ``memory_allowed`` is ``True``.

Pure and deterministic — no DB, no network, no model. The consent decision is made
upstream (``LearningApi._memory_consent_allowed``) and passed in here as a hard
flag, so the gate is enforced both at the API boundary and at the point of use
(defence in depth). The callback is screened with the safeguarding lexicon before
it is returned, so a poisoned topic string can never reach a learner.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, List, Mapping, Optional, Sequence

from src.learning.memory_policy import is_safeguarding
from src.learning.misconceptions import MisconceptionCode, get_entry

# Only recall a trap once it has caught the learner more than once — a single slip
# is noise, a repeat is a pattern worth surfacing.
MIN_TRAP_OCCURRENCES = 2
# How far back an attempt counts towards a recurring trap.
DEFAULT_LOOKBACK_DAYS = 30
# Cap how many traps a single callback mentions (keep the nudge short).
MAX_CALLBACK_TRAPS = 2

_TRUTHY = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class TrapSummary:
    """A recurring misconception trap distilled from attempt history."""

    code: str
    label: str
    topic: str
    count: int
    last_seen: Optional[datetime]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    return str(value).strip().lower() in _TRUTHY


def _parse_dt(value: Any) -> Optional[datetime]:
    """Best-effort ISO-8601 parse → aware UTC datetime, else ``None``."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _first(record: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        raw = record.get(key)
        if raw:
            text = str(raw).strip()
            if text:
                return text
    return ""


def _label_for_code(code: str) -> str:
    """Human label from the taxonomy when ``code`` is known, else the raw code."""
    try:
        return get_entry(MisconceptionCode(code)).label
    except (ValueError, KeyError):
        return code.replace("_", " ").strip()


def summarise_traps(
    attempts: Sequence[Mapping[str, Any]],
    *,
    now: Optional[datetime] = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    min_occurrences: int = MIN_TRAP_OCCURRENCES,
) -> List[TrapSummary]:
    """Group recent wrong attempts into ranked recurring misconception traps.

    An attempt counts when it has a misconception code, is not a correct answer
    (``correct`` truthy is skipped; absent is treated as a logged trap), and —
    when it carries a parseable timestamp — falls inside the lookback window.
    Traps are grouped by ``(code, topic)`` and only those at or above
    ``min_occurrences`` are returned, ordered by count then recency.
    """
    moment = now or _utcnow()
    cutoff = moment - timedelta(days=max(0, lookback_days))

    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for record in attempts:
        if not isinstance(record, Mapping):
            continue
        if _coerce_bool(record.get("correct")) is True:
            continue  # a correct answer is not a trap
        code = _first(record, "misconception_code", "misconception", "code").lower()
        if not code:
            continue
        topic = _first(record, "topic", "weak_topic", "topic_label", "skill_id") or "this topic"
        occurred = _parse_dt(
            record.get("occurred_at") or record.get("timestamp") or record.get("created_at")
        )
        if occurred is not None and occurred < cutoff:
            continue  # outside the recall window

        key = (code, topic.lower())
        bucket = groups.get(key)
        if bucket is None:
            bucket = {"code": code, "topic": topic, "count": 0, "last_seen": None}
            groups[key] = bucket
        bucket["count"] += 1
        if occurred is not None and (
            bucket["last_seen"] is None or occurred > bucket["last_seen"]
        ):
            bucket["last_seen"] = occurred

    summaries = [
        TrapSummary(
            code=bucket["code"],
            label=_label_for_code(bucket["code"]),
            topic=bucket["topic"],
            count=bucket["count"],
            last_seen=bucket["last_seen"],
        )
        for bucket in groups.values()
        if bucket["count"] >= max(1, min_occurrences)
    ]
    summaries.sort(
        key=lambda s: (s.count, s.last_seen or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )
    return summaries


def _times_word(count: int) -> str:
    if count == 2:
        return "twice"
    return f"{count} times"


def build_memory_callback(
    attempts: Sequence[Mapping[str, Any]],
    *,
    memory_allowed: bool,
    now: Optional[datetime] = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    max_traps: int = MAX_CALLBACK_TRAPS,
) -> Optional[str]:
    """Consent-gated cross-session callback for recurring misconception traps.

    Returns ``None`` when memory consent is off, when there is no recurring trap,
    or when the assembled line trips the safeguarding lexicon (defensive — the
    topic strings are learner/teacher authored). Otherwise returns a short nudge
    naming up to ``max_traps`` traps the learner keeps falling into, e.g.
    "Heads up — the sign error trap caught you twice on Algebra recently. Let's
    keep an eye on it today."
    """
    if not memory_allowed:
        return None

    summaries = summarise_traps(attempts, now=now, lookback_days=lookback_days)
    if not summaries:
        return None

    chosen = summaries[: max(1, max_traps)]
    phrases = [
        f"the {s.label.lower()} trap caught you {_times_word(s.count)} on {s.topic} recently"
        for s in chosen
    ]
    if len(phrases) == 1:
        body = f"Heads up — {phrases[0]}. Let's keep an eye on it today."
    else:
        body = (
            "Heads up — "
            + "; ".join(phrases)
            + ". Let's keep an eye on those today."
        )

    if is_safeguarding(body):
        return None
    return body


__all__ = [
    "MIN_TRAP_OCCURRENCES",
    "DEFAULT_LOOKBACK_DAYS",
    "MAX_CALLBACK_TRAPS",
    "TrapSummary",
    "summarise_traps",
    "build_memory_callback",
]
