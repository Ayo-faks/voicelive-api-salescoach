"""Track A increment 1 — safeguarding authorization probes + handler.

Offline regression suite for the mesh's deterministic veto authority,
:class:`~src.agents.safeguarding_agent.SafeguardingAgent`. It mirrors the
``safety_probes.py`` pattern: a ``default_probes()`` accessor gated by a
kill-switch flag plus a deterministic handler the harness drives.

What is being evaluated here is the **real** ``SafeguardingAgent.assess()``
decision path — not a stand-in — because that agent is pure, read-only,
deterministic logic (no LLM, no network). Running it under a *pinned* set of
safety-gate env vars makes the suite hermetic: the same probe always yields
the same verdict regardless of the ambient environment.

Two probe categories carry the success signal:

* ``safeguarding`` — a **veto is expected**. A probe that the agent wrongly
  *allows* is a safeguarding miss (SM-D2 hard zero).
* ``benign`` — an **allow is expected**. A probe the agent wrongly *vetoes*
  is a false positive (SM-D1 ceiling 0.10).

All personas and payloads are synthetic; there is no real PII. The single
contact string in the PII transcript probe uses an ``@example.invalid``
address by design so it can never resolve to a real mailbox.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Mapping, Optional, Sequence, Tuple

from src.agents.safeguarding_agent import SafeguardingAgent
from src.learning.eval.harness import ProbeCase
from src.services import safety_gates


SAFEGUARDING_PROBES_FLAG = "LEARNING_SAFEGUARDING_PROBES_V1"

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "safeguarding_probes.json"


class SafeguardingProbesUnavailableError(RuntimeError):
    """Raised when the safeguarding probes kill-switch flag is unset."""


def _load_fixture() -> Dict[str, Any]:
    with _FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _build_probes() -> Tuple[ProbeCase, ...]:
    data = _load_fixture()
    probes = tuple(ProbeCase(**entry) for entry in data["probes"])
    if not probes:  # pragma: no cover - defensive
        raise ValueError("safeguarding fixture contains no probes")
    return probes


_FIXTURE = _load_fixture()
_DEFAULT_PROBES: Tuple[ProbeCase, ...] = _build_probes()

# Pinned safety-gate environment so the deterministic gates (session caps,
# content review) resolve identically on every machine/CI run. Pulled from
# the fixture's ``_meta`` block so the data and the env stay in lockstep.
_PINNED_ENV: Dict[str, str] = dict(_FIXTURE["_meta"]["pinned_env"])

# Env vars that must be *absent* for the pinned baseline to hold (kill switch
# off; do not globally allow unreviewed content).
_CLEARED_ENV: Tuple[str, ...] = (
    safety_gates.ENV_LEARNER_VOICE_KILL_SWITCH,
    safety_gates.ENV_ALLOW_UNREVIEWED_CONTENT,
)

# Synthetic (user_id, child_id) pairs the fake storage treats as linked.
_CHILD_ACCESS_ALLOWLIST: frozenset[Tuple[str, str]] = frozenset(
    (str(pair[0]), str(pair[1])) for pair in _FIXTURE["_meta"]["child_access_allowlist"]
)


def default_probes(require_flag: bool = True) -> Tuple[ProbeCase, ...]:
    if require_flag and not os.environ.get(SAFEGUARDING_PROBES_FLAG):
        raise SafeguardingProbesUnavailableError(
            f"safeguarding probes gated by {SAFEGUARDING_PROBES_FLAG}; set to enable"
        )
    return _DEFAULT_PROBES


@contextmanager
def _pinned_safety_env() -> Iterator[None]:
    """Pin the safety-gate env vars for the duration of one assessment.

    Saves and restores any pre-existing values so the suite never leaks
    state into the surrounding process or other tests.
    """
    saved: Dict[str, Optional[str]] = {}
    for name in (*_PINNED_ENV.keys(), *_CLEARED_ENV):
        saved[name] = os.environ.get(name)
    try:
        for name, value in _PINNED_ENV.items():
            os.environ[name] = value
        for name in _CLEARED_ENV:
            os.environ.pop(name, None)
        yield
    finally:
        for name, prior in saved.items():
            if prior is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = prior


class _AllowlistStorage:
    """Minimal deterministic stand-in for the storage service.

    Only ``user_has_child_access`` is exercised by the child-access probes;
    it answers purely from a synthetic allowlist so no real data store is
    touched.
    """

    def __init__(self, allowlist: frozenset[Tuple[str, str]]) -> None:
        self._allowlist = allowlist

    def user_has_child_access(
        self,
        user_id: str,
        child_id: str,
        *,
        allowed_relationships: Optional[Sequence[str]] = None,
        include_deleted: bool = False,
    ) -> bool:
        return (str(user_id), str(child_id)) in self._allowlist


class safeguarding_fixture_handler:
    """Drives the real :class:`SafeguardingAgent` for each probe.

    The handler maps a :class:`SafeguardingVerdict` onto the harness outcome
    vocabulary: an allowed action → ``answer`` (the action proceeds), a vetoed
    action → ``refusal`` (the action is blocked). A fresh agent is built per
    probe so no per-agent state (e.g. tool budgets) carries across cases.
    """

    def __init__(
        self,
        *,
        allowlist: frozenset[Tuple[str, str]] = _CHILD_ACCESS_ALLOWLIST,
    ) -> None:
        self._allowlist = allowlist

    def handle(self, probe: ProbeCase) -> Dict[str, Any]:
        action = probe.metadata.get("action")
        if not isinstance(action, Mapping):  # pragma: no cover - defensive
            raise ValueError(
                f"probe {probe.probe_id!r} is missing metadata.action descriptor"
            )
        agent = SafeguardingAgent(_AllowlistStorage(self._allowlist))
        with _pinned_safety_env():
            verdict = agent.assess(action)
        outcome = "answer" if verdict.allowed else "refusal"
        decision = "allow" if verdict.allowed else "veto"
        return {
            "outcome": outcome,
            "response_excerpt": f"{decision}:{verdict.reason}",
            "latency_ms": 0.0,
            "cost_micro_usd": 0,
        }
