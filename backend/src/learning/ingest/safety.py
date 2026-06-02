"""Deterministic age-appropriateness + topical-scope gate for candidate chunks.

Constraint #1 (child safety, ages 11–17): no unvetted text reaches a learner.
A chunk that trips any rule here is **quarantined** — never emitted to the
corpus — and the reason is logged. This gate is intentionally conservative and
deterministic (no network, no model calls) so a build is reproducible.

It is a backstop, not a substitute for human review of the authored notes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Pattern

from .chunker import MAX_WORDS, MIN_WORDS, Chunk

# Categories of content that must never appear in child-facing explanations.
# Patterns are word-boundary anchored and case-insensitive. Curriculum terms
# that are legitimately academic (e.g. "reproduction" in Biology, "war" in
# History) are deliberately NOT blocked; the list targets graphic/explicit,
# self-harm, hard drugs, profanity, and data-solicitation content.
_UNSAFE_PATTERNS: List[Pattern[str]] = [
    re.compile(r"\b(porn|pornographic|explicit\s+sex|sexually\s+explicit)\b", re.I),
    re.compile(r"\b(suicide|self[-\s]?harm|kill\s+yourself)\b", re.I),
    re.compile(r"\b(heroin|cocaine|meth(amphetamine)?|get\s+high\s+on)\b", re.I),
    re.compile(r"\b(f\*{2,}k|fuck|shit|bitch|bastard)\b", re.I),
    re.compile(r"\b(your\s+(home\s+)?address|phone\s+number|send\s+me\s+your)\b", re.I),
    re.compile(r"\b(gore|graphic\s+violence|mutilat\w*)\b", re.I),
]

# A chunk should look like an explanation, not a question dump or a stray link.
_URL_PATTERN = re.compile(r"https?://\S+")


@dataclass(frozen=True)
class SafetyResult:
    passed: bool
    reasons: List[str] = field(default_factory=list)


def review_chunk(chunk: Chunk) -> SafetyResult:
    """Return a :class:`SafetyResult` for a single chunk."""
    reasons: List[str] = []
    text = chunk.text or ""

    if not text.strip():
        reasons.append("empty_body")

    for pat in _UNSAFE_PATTERNS:
        if pat.search(text) or pat.search(chunk.title or ""):
            reasons.append(f"unsafe_term:{pat.pattern}")

    if _URL_PATTERN.search(text):
        reasons.append("contains_url")

    # Topical-scope / quality band: too short to teach, or runaway long.
    if chunk.word_count < MIN_WORDS:
        reasons.append(f"too_short:{chunk.word_count}<{MIN_WORDS}")
    if chunk.word_count > MAX_WORDS:
        reasons.append(f"too_long:{chunk.word_count}>{MAX_WORDS}")

    # Scope sanity: a chunk must declare the subject/year/topic it teaches.
    if not chunk.key.subject or not chunk.key.year_group or not chunk.key.topic:
        reasons.append("missing_curriculum_key")

    return SafetyResult(passed=not reasons, reasons=reasons)
