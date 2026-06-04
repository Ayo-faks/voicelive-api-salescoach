"""CriticAgent — read-only quality reviewer of planner turn results.

Phase 4 of the agent mesh. The critic inspects a completed planner result
(anything shaped like
:class:`~src.services.insights_service.InsightsPlannerResult`) and returns a
structured, advisory :class:`Critique`. It is the mesh's *quality* signal,
complementing the SafeguardingAgent's *safety* signal.

Design rules (consistent with the rest of the mesh):

* **Read-only and non-raising.** The critic never mutates the result, never
  performs I/O, and never raises — a problem is a finding, not an exception.
* **Advisory only.** A critique never blocks a turn on its own. Call sites
  decide whether ``needs_revision`` triggers a retry, a human review, or is
  merely logged. This keeps existing behaviour byte-identical when the mesh
  is dark.
* **Heuristic, not a model.** Phase 4 checks are cheap deterministic rules
  (empty answer, planner error, uncited factual claim, oversized output).
  A model-backed critic can replace ``_check_*`` later without changing the
  :class:`Critique` contract.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from src.agents.base import MeshAgent

# Severity ranking (mirrors AIOpsAgent's scheme for consistency).
SEVERITY_OK = "ok"
SEVERITY_WARN = "warn"
SEVERITY_CRITICAL = "critical"
_SEVERITY_RANK = {SEVERITY_OK: 0, SEVERITY_WARN: 1, SEVERITY_CRITICAL: 2}

# Stable finding codes for logs / dashboards.
CODE_EMPTY_ANSWER = "empty_answer"
CODE_PLANNER_ERROR = "planner_error"
CODE_UNCITED_CLAIM = "uncited_claim"
CODE_OVERSIZED_ANSWER = "oversized_answer"

# Phrases that imply a factual/data claim a therapist would expect a citation for.
_CLAIM_MARKERS = (
    "according to",
    "the data shows",
    "research shows",
    "studies show",
    "the record shows",
    "sessions indicate",
    "% of",
    "percent of",
)


@dataclass(frozen=True)
class CritiqueFinding:
    """A single quality observation about a planner result."""

    code: str
    severity: str
    message: str

    @property
    def is_problem(self) -> bool:
        return self.severity != SEVERITY_OK


@dataclass(frozen=True)
class Critique:
    """Outcome of a quality review. Advisory; never blocks on its own."""

    severity: str
    findings: Tuple[CritiqueFinding, ...] = ()

    @property
    def problems(self) -> Tuple[CritiqueFinding, ...]:
        return tuple(f for f in self.findings if f.is_problem)

    @property
    def clean(self) -> bool:
        return self.severity == SEVERITY_OK

    @property
    def needs_revision(self) -> bool:
        """True when at least one CRITICAL finding was raised.

        Warnings are surfaced but do not, by themselves, request a revision —
        callers can tighten this by inspecting :attr:`problems` directly.
        """
        return self.severity == SEVERITY_CRITICAL

    def as_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity,
            "clean": self.clean,
            "needs_revision": self.needs_revision,
            "findings": [
                {"code": f.code, "severity": f.severity, "message": f.message}
                for f in self.findings
            ],
        }


_CRITIC_TOOLS = ("review_result",)


# Default guardrails (env-overridable).
def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class CriticAgent(MeshAgent):
    """Reviews a planner result and returns an advisory :class:`Critique`."""

    name = "critic-agent"

    def __init__(self, *, tool_call_budget: Optional[int] = None) -> None:
        super().__init__(
            allowed_tools=_CRITIC_TOOLS,
            tool_call_budget=tool_call_budget,
        )
        # Therapist answers above this length are flagged as oversized.
        self.max_answer_chars = _env_int("CRITIC_MAX_ANSWER_CHARS", 4000)

    def review(self, result: Any) -> Critique:
        """Inspect a planner result; return a non-raising :class:`Critique`.

        ``result`` is duck-typed against ``InsightsPlannerResult``: the critic
        reads ``answer_text``, ``citations``, and ``error_text`` defensively
        so a partial/foreign object can never crash the review.
        """

        self.ensure_tool_allowed("review_result")

        answer = self._safe_str(getattr(result, "answer_text", ""))
        citations = getattr(result, "citations", None) or []
        error_text = getattr(result, "error_text", None)

        findings: List[CritiqueFinding] = []
        for check in (
            self._check_planner_error,
            self._check_empty_answer,
            self._check_uncited_claim,
            self._check_oversized_answer,
        ):
            finding = check(answer=answer, citations=citations, error_text=error_text)
            if finding is not None:
                findings.append(finding)

        severity = self._overall_severity(findings)
        critique = Critique(severity=severity, findings=tuple(findings))

        self.log(
            "review",
            severity=severity,
            finding_count=len(findings),
            needs_revision=critique.needs_revision,
        )
        for problem in critique.problems:
            self.log("finding", code=problem.code, severity=problem.severity)
        return critique

    # -- Checks (each returns a finding or None) ----------------------------

    @staticmethod
    def _check_planner_error(
        *, answer: str, citations: Any, error_text: Optional[str]
    ) -> Optional[CritiqueFinding]:
        if error_text:
            return CritiqueFinding(
                code=CODE_PLANNER_ERROR,
                severity=SEVERITY_CRITICAL,
                message=f"planner reported an error: {error_text}",
            )
        return None

    @staticmethod
    def _check_empty_answer(
        *, answer: str, citations: Any, error_text: Optional[str]
    ) -> Optional[CritiqueFinding]:
        if not answer.strip():
            return CritiqueFinding(
                code=CODE_EMPTY_ANSWER,
                severity=SEVERITY_CRITICAL,
                message="answer_text is empty",
            )
        return None

    @staticmethod
    def _check_uncited_claim(
        *, answer: str, citations: Any, error_text: Optional[str]
    ) -> Optional[CritiqueFinding]:
        if not answer.strip():
            return None
        lowered = answer.lower()
        has_claim = any(marker in lowered for marker in _CLAIM_MARKERS)
        if has_claim and not citations:
            return CritiqueFinding(
                code=CODE_UNCITED_CLAIM,
                severity=SEVERITY_WARN,
                message="answer makes a factual claim but carries no citations",
            )
        return None

    def _check_oversized_answer(
        self, *, answer: str, citations: Any, error_text: Optional[str]
    ) -> Optional[CritiqueFinding]:
        if len(answer) > self.max_answer_chars:
            return CritiqueFinding(
                code=CODE_OVERSIZED_ANSWER,
                severity=SEVERITY_WARN,
                message=(
                    f"answer is {len(answer)} chars, over the "
                    f"{self.max_answer_chars} guardrail"
                ),
            )
        return None

    # -- Helpers ------------------------------------------------------------

    @staticmethod
    def _safe_str(value: Any) -> str:
        return value if isinstance(value, str) else ("" if value is None else str(value))

    @staticmethod
    def _overall_severity(findings: List[CritiqueFinding]) -> str:
        worst = SEVERITY_OK
        for finding in findings:
            if _SEVERITY_RANK[finding.severity] > _SEVERITY_RANK[worst]:
                worst = finding.severity
        return worst


__all__ = [
    "CriticAgent",
    "Critique",
    "CritiqueFinding",
    "SEVERITY_OK",
    "SEVERITY_WARN",
    "SEVERITY_CRITICAL",
    "CODE_EMPTY_ANSWER",
    "CODE_PLANNER_ERROR",
    "CODE_UNCITED_CLAIM",
    "CODE_OVERSIZED_ANSWER",
]
