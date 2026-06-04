"""Online rollback adapter — turns a gate report into a *proposal*.

Increment 5 of Track A. This is the first piece of the **online** (over-time)
control loop: it reads the structured verdict an
:class:`~src.agents.observability_gate.ObservabilityReport` already produces and
maps it into a single, auditable :class:`RollbackDecision`.

Hard constraints (consistent with the rest of the mesh):

* **Proposal only.** The adapter never deploys, applies, or rolls anything back.
  Every :class:`RollbackDecision` carries ``proposal=True``; promoting an action
  into a real pipeline is explicitly out of scope. The caller decides whether to
  act on a ``rollback`` proposal.
* **Shadow / dark by default.** Behind ``AGENT_MESH_ENABLED`` *and* its own
  ``AGENT_MESH_ROLLBACK_V1`` kill-switch. When either is unset (and ``force`` is
  not passed) :meth:`decide` is a no-op that returns a ``hold`` proposal flagged
  ``disabled`` — it can never set an exit code or change behaviour.
* **Non-raising.** Missing or malformed reports degrade to a conservative
  ``hold`` (fail-safe — never propose a rollback off a report we could not
  read), never an exception that could crash an online loop.
* **Dependency-free.** Only stdlib. Inputs are duck-typed (an
  ``ObservabilityReport``, its ``as_dict`` payload, or any mapping with a
  ``status`` / ``gate_passed``) so the adapter is trivially unit-testable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional, Tuple

from src.agents.base import agent_mesh_enabled

# Reuse the gate's own status vocabulary so the two stay in lock-step. These are
# plain string constants on a sanctioned mesh module — importing keeps the
# mapping authoritative rather than re-declaring magic strings here.
from src.agents.observability_gate import (
    STATUS_BLOCKED,
    STATUS_DISABLED,
    STATUS_ERROR,
)

# --- Proposal actions -------------------------------------------------------

ACTION_HOLD = "hold"  # stay on the current release — no action proposed
ACTION_ROLLBACK = "rollback"  # propose reverting to the previous known-good release

# Per-feature kill-switch. Dark by default; the online rollback proposal path
# only runs when this *and* ``AGENT_MESH_ENABLED`` are truthy (or ``force``).
ROLLBACK_FLAG = "AGENT_MESH_ROLLBACK_V1"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    value = raw.strip().lower()
    if not value:
        return default
    return value in _TRUTHY


def rollback_adapter_enabled() -> bool:
    """Whether the online rollback proposal path is opt-in enabled.

    Requires both the mesh master switch and this feature's own flag, mirroring
    the durable-sink / probe-suite dark-by-default discipline.
    """
    return agent_mesh_enabled() and _flag(ROLLBACK_FLAG, default=False)


@dataclass(frozen=True)
class RollbackDecision:
    """Outcome of mapping one gate report to a rollback *proposal*. Never acts.

    * ``action`` is always one of :data:`ACTION_HOLD` / :data:`ACTION_ROLLBACK`.
    * ``proposal`` is always ``True`` — this object is advisory; nothing in the
      mesh consumes it to mutate a release.
    * ``disabled`` is ``True`` when the adapter was dark (no real evaluation
      happened); such a decision is always a ``hold``.
    """

    action: str
    proposal: bool = True
    disabled: bool = False
    gate_status: Optional[str] = None
    reasons: Tuple[str, ...] = ()
    checks: Dict[str, Any] = field(default_factory=dict)

    @property
    def should_rollback(self) -> bool:
        """Convenience: only an active ``rollback`` proposal suggests reverting."""
        return self.action == ACTION_ROLLBACK and not self.disabled

    @property
    def holds(self) -> bool:
        return self.action == ACTION_HOLD

    def as_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action,
            "proposal": self.proposal,
            "disabled": self.disabled,
            "should_rollback": self.should_rollback,
            "gate_status": self.gate_status,
            "reasons": list(self.reasons),
            "checks": dict(self.checks),
        }


def _extract(report: Any) -> Tuple[Optional[str], Optional[bool], Tuple[str, ...]]:
    """Duck-type a gate report into ``(status, gate_passed, reasons)``.

    Accepts an :class:`ObservabilityReport`, its ``as_dict`` payload, or any
    mapping. Never raises — anything unreadable yields ``(None, None, ())``.
    """
    status: Optional[str] = None
    gate_passed: Optional[bool] = None
    reasons: Tuple[str, ...] = ()

    def _coerce_reasons(value: Any) -> Tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, str):
            return (value,)
        try:
            return tuple(str(item) for item in value)
        except TypeError:
            return (str(value),)

    if isinstance(report, Mapping):
        raw_status = report.get("status")
        status = str(raw_status) if raw_status is not None else None
        if "gate_passed" in report:
            gate_passed = bool(report.get("gate_passed"))
        reasons = _coerce_reasons(report.get("reasons"))
        return status, gate_passed, reasons

    raw_status = getattr(report, "status", None)
    if raw_status is not None:
        status = str(raw_status)
    raw_gate_passed = getattr(report, "gate_passed", None)
    if raw_gate_passed is not None:
        try:
            gate_passed = bool(raw_gate_passed)
        except Exception:  # pragma: no cover - defensive
            gate_passed = None
    reasons = _coerce_reasons(getattr(report, "reasons", None))
    return status, gate_passed, reasons


class RollbackAdapter:
    """Maps a gate report to a rollback *proposal*. Read-only, never acts.

    Construct once and call :meth:`decide` with whatever the observability gate
    produced this cycle. The adapter returns a :class:`RollbackDecision`; acting
    on a ``rollback`` proposal is a deliberate, separate, human-gated step.
    """

    name = "rollback-adapter"

    def decide(self, report: Any = None, *, force: bool = False) -> RollbackDecision:
        """Return a rollback proposal for ``report``.

        * Dark (mesh off or feature flag unset, and ``force`` not set) → a
          ``hold`` proposal flagged ``disabled``; nothing was evaluated.
        * Gate ``blocked`` / ``error`` (or ``gate_passed`` explicitly False) →
          a ``rollback`` proposal.
        * Anything else (ok / degraded / disabled / unreadable) → ``hold``
          (fail-safe: we never propose a rollback off a report we could not
          confidently read as a hard failure).
        """
        if not force and not rollback_adapter_enabled():
            return RollbackDecision(
                action=ACTION_HOLD,
                disabled=True,
                reasons=("rollback adapter dark — mesh or AGENT_MESH_ROLLBACK_V1 unset",),
            )

        status, gate_passed, reasons = _extract(report)

        if status is None and gate_passed is None:
            return RollbackDecision(
                action=ACTION_HOLD,
                gate_status=status,
                reasons=("unreadable gate report — holding (fail-safe)",),
                checks={"readable": False},
            )

        hard_failure = status in (STATUS_BLOCKED, STATUS_ERROR) or gate_passed is False
        # A dark/disabled gate is explicitly *not* a failure — nothing ran.
        if status == STATUS_DISABLED:
            hard_failure = False

        if hard_failure:
            proposal_reasons: Tuple[str, ...] = reasons or (
                f"gate status '{status}' indicates a hard failure",
            )
            return RollbackDecision(
                action=ACTION_ROLLBACK,
                gate_status=status,
                reasons=proposal_reasons,
                checks={"gate_passed": gate_passed, "gate_status": status},
            )

        return RollbackDecision(
            action=ACTION_HOLD,
            gate_status=status,
            reasons=(),
            checks={"gate_passed": gate_passed, "gate_status": status},
        )


__all__ = [
    "ACTION_HOLD",
    "ACTION_ROLLBACK",
    "ROLLBACK_FLAG",
    "RollbackAdapter",
    "RollbackDecision",
    "rollback_adapter_enabled",
]
