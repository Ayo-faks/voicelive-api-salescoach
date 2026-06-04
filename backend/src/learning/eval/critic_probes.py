"""Track A increment 2 — critic quality probes + handler.

Offline regression suite for the mesh's deterministic quality reviewer,
:class:`~src.agents.critic_agent.CriticAgent`. Mirrors the ``safety_probes`` /
``safeguarding_probes`` pattern: a ``default_probes()`` accessor gated by a
kill-switch flag plus a deterministic handler the harness drives.

As with the safeguarding suite, the handler exercises the **real**
``CriticAgent.review()`` decision path — it is pure, deterministic, no-LLM,
no-network logic — under a *pinned* guardrail env so the verdict is hermetic.

Two probe categories carry the success signal:

* ``answer_quality`` — the critic **should demand a revision** (a CRITICAL
  finding → ``needs_revision`` → mapped to the ``violation`` outcome). A probe
  the critic wrongly passes is a quality miss.
* ``benign`` — the critic should **not** demand a revision (a clean or
  warn-only result → mapped to ``answer``). A benign probe the critic wrongly
  escalates to a revision is a false positive (SM-D1 ceiling 0.10).

All planner results are synthetic; there is no real PII.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Iterator, Mapping, Optional, Tuple

from src.agents.critic_agent import CriticAgent
from src.learning.eval.harness import ProbeCase


CRITIC_PROBES_FLAG = "LEARNING_CRITIC_PROBES_V1"

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "critic_probes.json"


class CriticProbesUnavailableError(RuntimeError):
    """Raised when the critic probes kill-switch flag is unset."""


def _load_fixture() -> Dict[str, Any]:
    with _FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _build_probes() -> Tuple[ProbeCase, ...]:
    data = _load_fixture()
    probes = tuple(ProbeCase(**entry) for entry in data["probes"])
    if not probes:  # pragma: no cover - defensive
        raise ValueError("critic fixture contains no probes")
    return probes


_FIXTURE = _load_fixture()
_DEFAULT_PROBES: Tuple[ProbeCase, ...] = _build_probes()

# Pinned guardrail env so ``CRITIC_MAX_ANSWER_CHARS`` resolves identically on
# every machine/CI run (the oversized-answer probe relies on a small ceiling).
_PINNED_ENV: Dict[str, str] = dict(_FIXTURE["_meta"]["pinned_env"])


def default_probes(require_flag: bool = True) -> Tuple[ProbeCase, ...]:
    if require_flag and not os.environ.get(CRITIC_PROBES_FLAG):
        raise CriticProbesUnavailableError(
            f"critic probes gated by {CRITIC_PROBES_FLAG}; set to enable"
        )
    return _DEFAULT_PROBES


@contextmanager
def _pinned_critic_env() -> Iterator[None]:
    """Pin the critic guardrail env for the duration of one review.

    Saves and restores any pre-existing values so the suite never leaks state
    into the surrounding process or other tests.
    """
    saved: Dict[str, Optional[str]] = {
        name: os.environ.get(name) for name in _PINNED_ENV
    }
    try:
        for name, value in _PINNED_ENV.items():
            os.environ[name] = value
        yield
    finally:
        for name, prior in saved.items():
            if prior is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = prior


def _result_from(payload: Mapping[str, Any]) -> SimpleNamespace:
    """Build a duck-typed planner result the critic can read defensively."""
    return SimpleNamespace(
        answer_text=payload.get("answer_text", ""),
        citations=payload.get("citations") or [],
        error_text=payload.get("error_text"),
    )


class critic_fixture_handler:
    """Drives the real :class:`CriticAgent` for each probe.

    Maps a :class:`Critique` onto the harness outcome vocabulary: a critique
    that demands a revision (a CRITICAL finding) → ``violation`` (the turn
    must not be served as-is); otherwise → ``answer`` (clean or warn-only, the
    turn proceeds). A fresh agent is built per probe so no per-agent state
    carries across cases.
    """

    def handle(self, probe: ProbeCase) -> Dict[str, Any]:
        payload = probe.metadata.get("result")
        if not isinstance(payload, Mapping):  # pragma: no cover - defensive
            raise ValueError(
                f"probe {probe.probe_id!r} is missing metadata.result descriptor"
            )
        with _pinned_critic_env():
            agent = CriticAgent()
            critique = agent.review(_result_from(payload))
        outcome = "violation" if critique.needs_revision else "answer"
        codes = ",".join(f.code for f in critique.findings)
        excerpt = f"{critique.severity}:{codes}" if codes else f"{critique.severity}:"
        return {
            "outcome": outcome,
            "response_excerpt": excerpt,
            "latency_ms": 0.0,
            "cost_micro_usd": 0,
        }
