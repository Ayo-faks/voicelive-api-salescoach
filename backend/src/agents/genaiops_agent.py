"""GenAIOpsAgent — release eval gate over the deterministic eval harness.

Phase 3 of the agent mesh. This agent wraps the existing Tier-1 eval harness
(``src.learning.eval.harness.run_suite`` + ``safety_probes.default_probes``)
and turns its :class:`EvalReport` into a structured, non-raising
:class:`GenAIOpsVerdict` that a release/deploy step can consult.

Constraints (consistent with the rest of the mesh):

* **Wraps, never reimplements.** All evaluation logic stays in the harness;
  this agent only orchestrates a run and classifies the outcome.
* **Non-raising.** Missing kill-switch flags, empty probe sets, or handler
  blow-ups produce a ``skipped`` / ``error`` verdict — never an exception that
  could crash a deploy pipeline. The verdict's :attr:`blocking` tells the
  caller whether to proceed.
* **Fail-closed default.** When the gate cannot run (flags unset, no probes),
  the verdict is *not* ``passed``; callers must opt into "skip means proceed"
  explicitly via :meth:`should_block`.
* **Read-only.** No state mutation, no deploy actions. Promotion of a verdict
  into an actual rollback/deploy decision is a later phase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from src.agents.base import MeshAgent

# --- Outcome states ---------------------------------------------------------

STATUS_PASSED = "passed"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"
STATUS_ERROR = "error"


@dataclass(frozen=True)
class GenAIOpsVerdict:
    """Outcome of an eval-gate run. Never raises; describes what happened.

    * ``passed``   → gate ran and met Tier-1 thresholds.
    * ``failed``   → gate ran and breached at least one threshold.
    * ``skipped``  → gate could not run (kill-switch unset / no probes).
    * ``error``    → harness/handler raised; treated as non-passing.
    """

    status: str
    pass_rate: Optional[float] = None
    counts: Dict[str, int] = field(default_factory=dict)
    blocking_reasons: Tuple[str, ...] = ()
    detail: str = ""
    report: Any = None  # the underlying EvalReport when one was produced

    @property
    def passed(self) -> bool:
        return self.status == STATUS_PASSED

    @property
    def blocking(self) -> bool:
        """True when a release MUST NOT proceed on this verdict.

        Anything that is not an explicit ``passed`` blocks by default
        (fail-closed): failures, errors, and could-not-run skips.
        """
        return self.status != STATUS_PASSED

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "passed": self.passed,
            "blocking": self.blocking,
            "pass_rate": self.pass_rate,
            "counts": dict(self.counts),
            "blocking_reasons": list(self.blocking_reasons),
            "detail": self.detail,
        }

    @classmethod
    def skipped(cls, detail: str) -> "GenAIOpsVerdict":
        return cls(status=STATUS_SKIPPED, blocking_reasons=("gate_skipped",), detail=detail)

    @classmethod
    def errored(cls, detail: str) -> "GenAIOpsVerdict":
        return cls(status=STATUS_ERROR, blocking_reasons=("gate_error",), detail=detail)


_GENAIOPS_TOOLS = ("run_eval_suite",)


class GenAIOpsAgent(MeshAgent):
    """Runs the Tier-1 eval harness and classifies the result as a verdict."""

    name = "genaiops-agent"

    def __init__(self, *, tool_call_budget: Optional[int] = None) -> None:
        super().__init__(
            allowed_tools=_GENAIOPS_TOOLS,
            tool_call_budget=tool_call_budget,
        )

    # -- Public API ---------------------------------------------------------

    def evaluate(
        self,
        handler: Any,
        *,
        probes: Optional[Sequence[Any]] = None,
        thresholds: Optional[Any] = None,
        suite_id: str = "genaiops-gate",
        require_flag: bool = True,
        require_probe_flag: bool = True,
    ) -> GenAIOpsVerdict:
        """Run the eval suite against ``handler`` and return a verdict.

        ``handler`` is any object exposing ``handle(probe) -> dict`` (the
        harness ``EvalHandlerProtocol``). When ``probes`` is omitted the
        default Tier-1 safety probe set is used. All failure modes are
        captured as non-passing verdicts rather than exceptions.
        """

        self.ensure_tool_allowed("run_eval_suite")

        # Import lazily so importing the agent never pulls in pydantic/harness
        # unless an evaluation is actually requested.
        try:
            from src.learning.eval import harness as eval_harness
        except Exception as exc:  # pragma: no cover - defensive import guard
            self.log("evaluate_skipped", reason="harness_import_failed", error=type(exc).__name__)
            return GenAIOpsVerdict.skipped(f"eval harness unavailable: {exc}")

        probe_list = self._resolve_probes(probes, require_probe_flag)
        if probe_list is None:
            self.log("evaluate_skipped", reason="probes_unavailable")
            return GenAIOpsVerdict.skipped("default safety probes unavailable (flag unset)")
        if not probe_list:
            self.log("evaluate_skipped", reason="no_probes")
            return GenAIOpsVerdict.skipped("no probes to run")

        self.log("evaluate_start", suite_id=suite_id, probe_count=len(probe_list))
        try:
            report = eval_harness.run_suite(
                handler,
                probe_list,
                suite_id=suite_id,
                thresholds=thresholds,
                require_flag=require_flag,
            )
        except eval_harness.EvalHarnessUnavailableError as exc:
            self.log("evaluate_skipped", reason="harness_flag_unset")
            return GenAIOpsVerdict.skipped(str(exc))
        except Exception as exc:  # defensive: a bad handler must not crash a deploy
            self.log("evaluate_error", error=type(exc).__name__)
            return GenAIOpsVerdict.errored(f"{type(exc).__name__}: {exc}")

        verdict = self._classify(report)
        self.log(
            "evaluate_end",
            status=verdict.status,
            pass_rate=verdict.pass_rate,
            blocking=verdict.blocking,
        )
        return verdict

    def should_block(self, verdict: GenAIOpsVerdict, *, skip_blocks: bool = True) -> bool:
        """Decide whether a release should be blocked given a verdict.

        ``skip_blocks`` (default True, fail-closed): a ``skipped`` verdict
        blocks the release. Set False to let an inoperable gate pass through
        (e.g. local dev where the eval flags are intentionally unset).
        """
        if verdict.status == STATUS_SKIPPED:
            return skip_blocks
        return verdict.blocking

    # -- Internals ----------------------------------------------------------

    @staticmethod
    def _resolve_probes(
        probes: Optional[Sequence[Any]],
        require_probe_flag: bool,
    ) -> Optional[List[Any]]:
        if probes is not None:
            return list(probes)
        try:
            from src.learning.eval.safety_probes import (
                SafetyProbesUnavailableError,
                default_probes,
            )
        except Exception:  # pragma: no cover - defensive import guard
            return None
        try:
            return list(default_probes(require_flag=require_probe_flag))
        except SafetyProbesUnavailableError:
            return None

    def _classify(self, report: Any) -> GenAIOpsVerdict:
        counts: Dict[str, int] = dict(getattr(report, "counts", {}) or {})
        pass_rate = getattr(report, "pass_rate", None)
        passed = bool(getattr(report, "passed", False))

        if passed:
            return GenAIOpsVerdict(
                status=STATUS_PASSED,
                pass_rate=pass_rate,
                counts=counts,
                detail="eval gate passed Tier-1 thresholds",
                report=report,
            )

        reasons = self._blocking_reasons(counts)
        return GenAIOpsVerdict(
            status=STATUS_FAILED,
            pass_rate=pass_rate,
            counts=counts,
            blocking_reasons=tuple(reasons),
            detail="eval gate breached Tier-1 thresholds",
            report=report,
        )

    @staticmethod
    def _blocking_reasons(counts: Dict[str, int]) -> List[str]:
        reasons: List[str] = []
        for key in (
            "critical_failures",
            "crisis_failures",
            "pii_leaks",
            "jailbreak_misses",
            "grounding_failures",
            "safeguarding_failures",
            "false_positives",
        ):
            if counts.get(key, 0) > 0:
                reasons.append(key)
        if not reasons and counts.get("failed", 0) > 0:
            reasons.append("pass_rate_below_threshold")
        return reasons


__all__ = [
    "GenAIOpsAgent",
    "GenAIOpsVerdict",
    "STATUS_PASSED",
    "STATUS_FAILED",
    "STATUS_SKIPPED",
    "STATUS_ERROR",
]
