"""Pure-function classifier: message text → :class:`RouteDecision`.

The classifier is deliberately rule-only in Phase 1 — no LLM call, no
embeddings — so it adds sub-millisecond overhead and is fully covered by
table-driven tests. Default is always ``insights`` on ambiguity; the
chitchat handler is the only path that can produce an unsourced reply
and we have an output filter + planner fallback as defence in depth.
"""

from __future__ import annotations

import re
from typing import Any, Mapping, Optional

from src.services.turn_router.rules import (
    CHITCHAT_ALLOW_PHRASES,
    CHITCHAT_FUZZY_MAX_WORDS,
    CHITCHAT_MAX_TOKENS,
    CHITCHAT_TOKEN_VOCAB,
    INSIGHTS_DENY_TOKENS,
    INSIGHTS_HARD_DENY_TOKENS,
)
from src.services.turn_router.types import RouteDecision, RouterConfig

# Strip ASCII punctuation; keep word chars + whitespace.
_PUNCT_RE = re.compile(r"[^\w\s]")
_DIGIT_RE = re.compile(r"\d")


def _normalise(message: str) -> str:
    lowered = (message or "").strip().lower()
    return _PUNCT_RE.sub(" ", lowered).strip()


def classify(
    message: str,
    *,
    scope: Optional[Mapping[str, Any]] = None,
    config: Optional[RouterConfig] = None,
) -> RouteDecision:
    """Return the :class:`RouteDecision` for ``message``.

    Order of evaluation:

    1. Empty / whitespace → ``insights`` (caller validates separately).
    2. Digit present → ``insights`` (numbers always concern data).
    3. Allow-phrase exact match → ``chitchat`` (rules, conf 1.0).
    4. L2 fuzzy/token vocab → ``chitchat`` (fuzzy, conf 0.6–0.9) when no
       hard-deny token, no digits, ``≤ CHITCHAT_FUZZY_MAX_WORDS`` words
       and at least one strong chitchat vocab token is present.
    5. Deny-token present → ``insights`` (rules).
    6. Token count > ``CHITCHAT_MAX_TOKENS`` → ``insights`` (length guard).
    7. Default → ``insights``.
    """

    del scope, config  # reserved for future layers (e.g. scope-name match).

    normalised = _normalise(message)
    if not normalised:
        return RouteDecision(
            route="insights",
            confidence=1.0,
            reason="empty",
            classifier="rules",
        )

    if _DIGIT_RE.search(normalised):
        return RouteDecision(
            route="insights",
            confidence=1.0,
            reason="deny:digit",
            classifier="rules",
        )

    if normalised in CHITCHAT_ALLOW_PHRASES:
        return RouteDecision(
            route="chitchat",
            confidence=1.0,
            reason="allow:exact",
            classifier="rules",
        )

    tokens = normalised.split()
    token_set = set(tokens)

    fuzzy_decision = _classify_fuzzy(tokens, token_set)
    if fuzzy_decision is not None:
        return fuzzy_decision

    hit_deny = token_set & INSIGHTS_DENY_TOKENS
    if hit_deny:
        return RouteDecision(
            route="insights",
            confidence=1.0,
            reason=f"deny:{sorted(hit_deny)[0]}",
            classifier="rules",
        )

    if len(tokens) > CHITCHAT_MAX_TOKENS:
        return RouteDecision(
            route="insights",
            confidence=0.9,
            reason="length_guard",
            classifier="rules",
        )

    return RouteDecision(
        route="insights",
        confidence=0.8,
        reason="default",
        classifier="rules",
    )


def _classify_fuzzy(
    tokens: list[str],
    token_set: set[str],
) -> Optional[RouteDecision]:
    """L2 fuzzy/token classifier.

    Routes to chitchat when the utterance is short, contains no
    hard-deny tokens, and overlaps the chitchat vocabulary by at least
    one strong token. Returns ``None`` to defer to the deny-token /
    length-guard / default cascade when criteria aren't met.
    """

    if len(tokens) > CHITCHAT_FUZZY_MAX_WORDS:
        return None

    if token_set & INSIGHTS_HARD_DENY_TOKENS:
        return None

    overlap = token_set & CHITCHAT_TOKEN_VOCAB
    if not overlap:
        return None

    # Confidence scales gently with overlap so multiple matched tokens
    # outrank a single-token match in any future tie-break logic. Capped
    # at 0.9 so rules-tier hits (1.0) always win.
    confidence = min(0.6 + 0.1 * len(overlap), 0.9)
    return RouteDecision(
        route="chitchat",
        confidence=confidence,
        reason=f"fuzzy:tokens={len(overlap)}",
        classifier="fuzzy",
    )
