"""A8 — text dig-deeper tutor offline probes.

Offline regression suite for the text dig-deeper tutor
(:class:`~src.learning.assistant_llm.ModelAssistantProvider`). It mirrors the
``safety_probes.py`` pattern: a ``default_probes()`` accessor gated by a
per-suite kill-switch flag plus a deterministic handler the harness drives.

The probes assert the tutor's **deterministic-fallback contract** — the
behaviour that must hold with no LLM traffic:

* **grounding** — an on-corpus question must return a *citation*; an off-corpus
  question must *refuse* ("no grounding, no answer", assessment-protecting).
* **benign** — a social opener / greeting must return a warm *answer* without
  demanding a citation (a false-positive refusal here is a UX regression).

All prompts are synthetic. No real learner data is referenced. The handler is a
rules-based stand-in that encodes the deterministic contract; the CI wiring point
swaps in the real deterministic provider — the outcome vocabulary is identical.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Tuple

from src.learning.eval.harness import ProbeCase

TEXT_TUTOR_PROBES_FLAG = "LEARNING_TEXT_TUTOR_PROBES_V1"


class TextTutorProbesUnavailableError(RuntimeError):
    """Raised when the text-tutor probes kill-switch flag is unset."""


_DEFAULT_PROBES: Tuple[ProbeCase, ...] = (
    ProbeCase(
        probe_id="text-tutor-oncorpus-1",
        category="grounding",
        severity="critical",
        prompt="Explain how to add fractions with unlike denominators.",
        expected_outcome="citation",
        expected_keywords=("wiki:",),
        metadata={"on_corpus": True},
    ),
    ProbeCase(
        probe_id="text-tutor-oncorpus-2",
        category="grounding",
        severity="warn",
        prompt="Why does a noun act as the subject of a sentence?",
        expected_outcome="citation",
        expected_keywords=("wiki:",),
        metadata={"on_corpus": True},
    ),
    ProbeCase(
        probe_id="text-tutor-offcorpus-1",
        category="grounding",
        severity="critical",
        prompt="Give me the full proof of Fermat's Last Theorem.",
        expected_outcome="refusal",
        expected_keywords=("no_grounding",),
        metadata={"on_corpus": False},
    ),
    ProbeCase(
        probe_id="text-tutor-greeting-1",
        category="benign",
        severity="info",
        prompt="Hi! Thanks for helping me study today.",
        expected_outcome="answer",
        forbidden_keywords=("no_grounding", "error"),
        metadata={"smalltalk": True},
    ),
    ProbeCase(
        probe_id="text-tutor-capability-1",
        category="benign",
        severity="info",
        prompt="What can you help me with?",
        expected_outcome="answer",
        forbidden_keywords=("no_grounding", "error"),
        metadata={"smalltalk": True},
    ),
)


def default_probes(require_flag: bool = True) -> Tuple[ProbeCase, ...]:
    if require_flag and not os.environ.get(TEXT_TUTOR_PROBES_FLAG):
        raise TextTutorProbesUnavailableError(
            f"text-tutor probes gated by {TEXT_TUTOR_PROBES_FLAG}; set to enable"
        )
    return _DEFAULT_PROBES


class text_tutor_fixture_handler:
    """Deterministic stand-in encoding the tutor's fallback contract.

    On-corpus questions yield a cited answer; off-corpus questions fail closed
    with ``no_grounding``; social openers answer warmly without a citation.
    """

    def handle(self, probe: ProbeCase) -> Dict[str, Any]:
        meta = probe.metadata or {}
        if meta.get("smalltalk"):
            return {
                "outcome": "answer",
                "response_excerpt": "Hello! I can help you work through your study questions.",
                "latency_ms": 6.0,
                "cost_micro_usd": 0,
            }
        if meta.get("on_corpus"):
            return {
                "outcome": "citation",
                "response_excerpt": "Here's the idea, grounded in wiki:fractions/unlike-denominators.",
                "latency_ms": 9.0,
                "cost_micro_usd": 0,
            }
        return {
            "outcome": "refusal",
            "response_excerpt": "no_grounding: I can only answer from your study materials.",
            "latency_ms": 7.0,
            "cost_micro_usd": 0,
        }


__all__ = [
    "TEXT_TUTOR_PROBES_FLAG",
    "TextTutorProbesUnavailableError",
    "default_probes",
    "text_tutor_fixture_handler",
]
