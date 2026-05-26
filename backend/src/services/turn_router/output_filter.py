"""Output filter: reject chitchat replies that smell like data.

This is the last line of defence before a chitchat reply is spoken. If
the small model hallucinated a number, a score, a child name, or any
data-shaped token we replace the whole reply with the canonical
fallback and signal the caller to fall through to the planner.
"""

from __future__ import annotations

import re
from typing import Any, Mapping, Optional, Tuple

from src.services.turn_router.rules import (
    CHITCHAT_FALLBACK_REPLY,
    CHITCHAT_OUTPUT_DIRTY_TOKENS,
)

_DIGIT_RE = re.compile(r"\d")
_WORD_RE = re.compile(r"[a-z']+")


def scrub_chitchat_response(
    text: str,
    *,
    scope: Optional[Mapping[str, Any]] = None,
) -> Tuple[str, bool]:
    """Return ``(reply, dirty)``.

    ``dirty=True`` means the original reply contained data-shaped content
    and was replaced with :data:`CHITCHAT_FALLBACK_REPLY`. The caller
    should then route to the planner.
    """

    del scope  # reserved: future scope-name leak checks.

    raw = (text or "").strip()
    if not raw:
        return CHITCHAT_FALLBACK_REPLY, True

    if _DIGIT_RE.search(raw):
        return CHITCHAT_FALLBACK_REPLY, True

    lowered = raw.lower()
    tokens = set(_WORD_RE.findall(lowered))
    if tokens & CHITCHAT_OUTPUT_DIRTY_TOKENS:
        return CHITCHAT_FALLBACK_REPLY, True

    if "%" in raw:
        return CHITCHAT_FALLBACK_REPLY, True

    return raw, False
