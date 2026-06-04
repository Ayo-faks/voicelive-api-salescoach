"""MigrationAgent — read-only, non-executing migration-readiness reviewer.

Phase 4 of the agent mesh. This agent inspects a set of proposed *migration
steps* (schema/data changes, backfills, config moves) and returns a structured,
advisory :class:`MigrationPlan` classifying each step by risk. It is the mesh's
*change-safety* signal — the schema/data analogue of the SafeguardingAgent.

Hard constraints (consistent with the rest of the mesh):

* **Never executes.** The agent runs no SQL, opens no connections, touches no
  files. It only reads the step descriptions it is handed and reasons about
  them. Its allow-list contains only inspection seams — never ``apply`` /
  ``migrate`` / ``drop``.
* **Read-only and non-raising.** A risky or malformed step is a *finding*, not
  an exception. Callers decide whether to proceed.
* **Fail-closed.** A step the agent cannot understand is treated as
  ``review_required`` (not auto-approved), and any irreversible step blocks an
  automatic go.
* **Heuristic, not a model.** Phase 4 uses cheap deterministic keyword rules
  over the step's ``operation``/``statement``. A richer analyser can replace
  ``_classify_step`` later without changing the :class:`MigrationPlan` contract.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from src.agents.base import MeshAgent

# --- Risk levels ------------------------------------------------------------

RISK_SAFE = "safe"  # additive / reversible (CREATE, ADD COLUMN nullable)
RISK_REVIEW = "review"  # needs a human look (data backfill, rename, unknown)
RISK_DESTRUCTIVE = "destructive"  # irreversible data/schema loss (DROP, DELETE)
_RISK_RANK = {RISK_SAFE: 0, RISK_REVIEW: 1, RISK_DESTRUCTIVE: 2}

# Stable finding codes for logs / dashboards.
CODE_DESTRUCTIVE_OP = "destructive_op"
CODE_IRREVERSIBLE = "irreversible"
CODE_NO_ROLLBACK = "no_rollback"
CODE_UNKNOWN_OP = "unknown_op"

# Keyword markers (matched case-insensitively against operation + statement).
_DESTRUCTIVE_MARKERS = (
    "drop table",
    "drop column",
    "drop database",
    "truncate",
    "delete from",
    "drop index",
    "drop constraint",
)
_SAFE_MARKERS = (
    "create table",
    "create index",
    "add column",
    "create schema",
    "insert into",
    "alter table add",
)
_REVIEW_MARKERS = (
    "rename",
    "alter column",
    "update ",
    "backfill",
    "alter table alter",
    "not null",
)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on", "enabled"}


# --- Findings / plan --------------------------------------------------------


@dataclass(frozen=True)
class MigrationFinding:
    """Risk classification of a single proposed migration step."""

    index: int
    name: str
    risk: str
    codes: Tuple[str, ...] = ()
    message: str = ""

    @property
    def is_blocking(self) -> bool:
        return self.risk == RISK_DESTRUCTIVE

    @property
    def needs_review(self) -> bool:
        return self.risk in (RISK_REVIEW, RISK_DESTRUCTIVE)


@dataclass(frozen=True)
class MigrationPlan:
    """Outcome of assessing a batch of migration steps. Never executes.

    * ``risk``      → highest risk across all steps.
    * ``approved``  → safe to auto-apply (no review/destructive steps, and no
      destructive step lacks a declared rollback).
    """

    risk: str
    findings: Tuple[MigrationFinding, ...]
    step_count: int

    @property
    def destructive(self) -> Tuple[MigrationFinding, ...]:
        return tuple(f for f in self.findings if f.risk == RISK_DESTRUCTIVE)

    @property
    def needs_review(self) -> Tuple[MigrationFinding, ...]:
        return tuple(f for f in self.findings if f.needs_review)

    @property
    def approved(self) -> bool:
        """True only when every step is safe (fail-closed otherwise)."""
        return self.risk == RISK_SAFE and self.step_count > 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "risk": self.risk,
            "approved": self.approved,
            "step_count": self.step_count,
            "destructive_count": len(self.destructive),
            "review_count": len(self.needs_review),
            "findings": [
                {
                    "index": f.index,
                    "name": f.name,
                    "risk": f.risk,
                    "codes": list(f.codes),
                    "message": f.message,
                }
                for f in self.findings
            ],
        }


_MIGRATION_TOOLS = ("inspect_migration_steps",)


class MigrationAgent(MeshAgent):
    """Read-only migration-readiness reviewer.

    Construct once and call :meth:`assess` with an iterable of step mappings.
    Each step may declare ``name``, ``operation`` and/or ``statement``, and an
    optional ``rollback`` (truthy if a down-migration exists). The agent never
    runs anything — it returns a :class:`MigrationPlan` and the caller decides.
    """

    name = "migration-agent"

    def __init__(self, *, tool_call_budget: Optional[int] = None) -> None:
        super().__init__(
            allowed_tools=_MIGRATION_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        # When set, a destructive step that declares a rollback is downgraded
        # from blocking to review (still never auto-approved).
        self.allow_rollback_downgrade = _env_flag(
            "MIGRATION_ALLOW_ROLLBACK_DOWNGRADE", default=False
        )

    # -- Public API -----------------------------------------------------

    def assess(self, steps: Iterable[Any]) -> MigrationPlan:
        """Classify each migration step by risk. Never raises, never executes."""
        findings: List[MigrationFinding] = []
        try:
            materialised = list(steps or [])
        except Exception:  # pragma: no cover - defensive
            materialised = []

        for idx, step in enumerate(materialised):
            findings.append(self._classify_step(idx, step))

        overall = self._overall_risk(findings)
        plan = MigrationPlan(
            risk=overall,
            findings=tuple(findings),
            step_count=len(findings),
        )
        self.log(
            "assess",
            step_count=plan.step_count,
            risk=plan.risk,
            destructive=len(plan.destructive),
            review=len(plan.needs_review),
        )
        for f in plan.findings:
            if f.is_blocking:
                self.log("destructive_step", index=f.index, name=f.name, codes=list(f.codes))
        return plan

    # -- Classification -------------------------------------------------

    def _classify_step(self, idx: int, step: Any) -> MigrationFinding:
        name = self._field(step, "name") or f"step-{idx}"
        operation = self._field(step, "operation")
        statement = self._field(step, "statement")
        has_rollback = self._has_rollback(step)
        haystack = f"{operation} {statement}".lower()

        codes: List[str] = []
        risk = RISK_REVIEW  # fail-closed default for unrecognised steps

        if not haystack.strip():
            codes.append(CODE_UNKNOWN_OP)
            message = "step declares no operation or statement; manual review required"
            return MigrationFinding(
                index=idx, name=name, risk=RISK_REVIEW, codes=tuple(codes), message=message
            )

        if any(marker in haystack for marker in _DESTRUCTIVE_MARKERS):
            risk = RISK_DESTRUCTIVE
            codes.append(CODE_DESTRUCTIVE_OP)
            if not has_rollback:
                codes.append(CODE_NO_ROLLBACK)
            else:
                codes.append(CODE_IRREVERSIBLE)
            # Even with a rollback, dropped data is not restored by a down
            # migration — so destructive stays blocking unless explicitly
            # downgraded via the kill-switch (and even then only to review).
            if has_rollback and self.allow_rollback_downgrade:
                risk = RISK_REVIEW
            message = "destructive operation detected; data/schema loss is irreversible"
        elif any(marker in haystack for marker in _SAFE_MARKERS) and not any(
            marker in haystack for marker in _REVIEW_MARKERS
        ):
            risk = RISK_SAFE
            message = "additive/reversible operation"
        elif any(marker in haystack for marker in _REVIEW_MARKERS):
            risk = RISK_REVIEW
            message = "potentially data-affecting operation; manual review required"
        else:
            codes.append(CODE_UNKNOWN_OP)
            message = "unrecognised operation; manual review required"

        return MigrationFinding(
            index=idx, name=name, risk=risk, codes=tuple(codes), message=message
        )

    # -- Internals ------------------------------------------------------

    @staticmethod
    def _field(step: Any, key: str) -> str:
        try:
            if isinstance(step, Mapping):
                value = step.get(key)
            else:
                value = getattr(step, key, None)
        except Exception:  # pragma: no cover - defensive
            return ""
        return "" if value is None else str(value)

    @staticmethod
    def _has_rollback(step: Any) -> bool:
        try:
            if isinstance(step, Mapping):
                value = step.get("rollback")
            else:
                value = getattr(step, "rollback", None)
        except Exception:  # pragma: no cover - defensive
            return False
        return bool(value)

    @staticmethod
    def _overall_risk(findings: List[MigrationFinding]) -> str:
        worst = RISK_SAFE
        for f in findings:
            if _RISK_RANK.get(f.risk, 0) > _RISK_RANK[worst]:
                worst = f.risk
        return worst


__all__ = [
    "MigrationAgent",
    "MigrationPlan",
    "MigrationFinding",
    "RISK_SAFE",
    "RISK_REVIEW",
    "RISK_DESTRUCTIVE",
    "CODE_DESTRUCTIVE_OP",
    "CODE_IRREVERSIBLE",
    "CODE_NO_ROLLBACK",
    "CODE_UNKNOWN_OP",
]
