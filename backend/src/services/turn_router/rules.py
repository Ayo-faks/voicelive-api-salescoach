"""Frozen rule constants for the Phase 1 chitchat / insights classifier.

Edits here change product behaviour. Pair every change with a row in
``tests/unit/test_turn_router_rules.py``.
"""

from __future__ import annotations

# Exact-match phrases (lowercased, punctuation-stripped, trimmed) that route
# to chitchat. Single tokens and short canned phrases only.
CHITCHAT_ALLOW_PHRASES: frozenset[str] = frozenset(
    {
        # Greetings
        "hi",
        "hello",
        "hey",
        "yo",
        "hiya",
        "howdy",
        "good morning",
        "good afternoon",
        "good evening",
        # Acknowledgements
        "thanks",
        "thank you",
        "ta",
        "cheers",
        "ok",
        "okay",
        "cool",
        "nice",
        "great",
        "awesome",
        "sorry",
        # Farewells
        "bye",
        "goodbye",
        "see you",
        "see ya",
        # Small talk / liveness checks
        "how are you",
        "how are you doing",
        "are you there",
        "you there",
        "can you hear me",
        "nice to meet you",
    }
)

# Verbs / keywords that, if present, force ``insights``. We always default
# to insights anyway, but recording the explicit reason in the route
# decision is useful for telemetry and debugging false-routes.
INSIGHTS_DENY_TOKENS: frozenset[str] = frozenset(
    {
        # Read verbs
        "show",
        "list",
        "tell",
        "find",
        "search",
        "look",
        "summarise",
        "summarize",
        "compare",
        "report",
        # Question words
        "what",
        "who",
        "how",
        "why",
        "when",
        "where",
        "which",
        # Data nouns
        "score",
        "scores",
        "mastery",
        "progress",
        "plan",
        "plans",
        "intervention",
        "interventions",
        "session",
        "sessions",
        "child",
        "children",
        "student",
        "students",
        "class",
        "classes",
        "assessment",
        "grade",
        "grades",
        # Time references
        "today",
        "yesterday",
        "week",
        "month",
        "term",
    }
)

# Tokens that, if present anywhere in a chitchat reply, mark it as dirty
# and force a fall-back to the planner. Intentionally permissive — false
# positives just cost a planner round-trip on a greeting, false negatives
# leak hallucinated data into the user's ear.
CHITCHAT_OUTPUT_DIRTY_TOKENS: frozenset[str] = frozenset(
    {
        "score",
        "scores",
        "mastery",
        "plan",
        "plans",
        "intervention",
        "interventions",
        "progress",
        "assessment",
        "report",
        "grade",
        "grades",
        "percent",
        "%",
        "session",
        "sessions",
    }
)

# Phase 1 caps the chitchat allow-list to short utterances. Anything
# longer is forced to insights via the length guard.
CHITCHAT_MAX_TOKENS: int = 8

# L2 fuzzy/token classifier: vocabulary of "strong" chitchat tokens. Any
# single-token overlap with this set is enough to flag as chitchat — but
# only when no hard-deny token is present and the utterance is short
# enough to be plausibly small-talk. Question words ("how", "what") and
# time references ("today") are deliberately excluded because they show
# up in both chitchat ("how are you") and data queries ("how did ada do
# today") with similar frequency.
CHITCHAT_TOKEN_VOCAB: frozenset[str] = frozenset(
    {
        # Greetings
        "hi",
        "hello",
        "hey",
        "yo",
        "hiya",
        "howdy",
        # Time-of-day greetings
        "morning",
        "afternoon",
        "evening",
        # Thanks
        "thanks",
        "thank",
        "ta",
        "cheers",
        "appreciate",
        # Acks / sentiment
        "ok",
        "okay",
        "cool",
        "nice",
        "great",
        "awesome",
        "sorry",
        "alright",
        "fine",
        "good",
        # Farewells
        "bye",
        "goodbye",
        "farewell",
        # Names of address
        "mate",
        "buddy",
        "pal",
        "friend",
        "sir",
        "madam",
        "dude",
        # Politeness
        "please",
        "welcome",
        "pleasure",
    }
)

# Hard-deny tokens for the L2 fuzzy classifier. Subset of
# ``INSIGHTS_DENY_TOKENS`` — only the data-bearing tokens (read verbs +
# data nouns) that unambiguously signal a data query. Question words and
# time references are *not* hard denies because they coexist with
# chitchat ("how are you", "good morning today").
INSIGHTS_HARD_DENY_TOKENS: frozenset[str] = frozenset(
    {
        # Read verbs
        "show",
        "list",
        "tell",
        "find",
        "search",
        "look",
        "summarise",
        "summarize",
        "compare",
        "report",
        # Data nouns
        "score",
        "scores",
        "mastery",
        "progress",
        "plan",
        "plans",
        "intervention",
        "interventions",
        "session",
        "sessions",
        "child",
        "children",
        "student",
        "students",
        "class",
        "classes",
        "assessment",
        "grade",
        "grades",
    }
)

# Maximum word count for the L2 fuzzy classifier. Beyond this we assume
# the utterance is a real query regardless of vocabulary overlap and
# defer to the existing deny / length-guard / default cascade.
CHITCHAT_FUZZY_MAX_WORDS: int = 10

# Canonical fallback string used by both the chitchat handler and the
# output filter to signal "I can't safely answer this without data; let
# the planner take it."
CHITCHAT_FALLBACK_REPLY: str = "I'll check that for you."
