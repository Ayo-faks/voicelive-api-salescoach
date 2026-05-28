"""Retry-after-explanation aggregation (MVP §4.3, north-star metric).

Pure-functional aggregation over an in-memory event stream — no DB calls.
The W3-B agent layer wires this into the events repository; for now the
aggregator is independently testable and CI-cheap.

The north-star metric (MVP §2) is the retry-success rate per
``(question_id, explanation_version)``. We also surface a Wilson 95% CI
so the dashboard can withhold flagging until sample size is meaningful
(small-N regressions are noise, not signal).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple


# z = 1.96 for a 95% CI. Hard-coded so the formula stays explainable; we
# don't need a multi-CI knob this sprint.
_Z_95 = 1.959963984540054


@dataclass(frozen=True)
class RetryOutcomeRecord:
    """Minimal shape the aggregator needs.

    Maps 1:1 onto the upcoming ``RetryOutcomeEvent`` (see xapi.py W3-A).
    Kept as a plain dataclass so the aggregator has no Pydantic dependency
    and stays trivially callable from tests and ad-hoc scripts.
    """

    question_id: str
    explanation_version: str
    succeeded: bool


@dataclass(frozen=True)
class RetrySuccessStat:
    question_id: str
    explanation_version: str
    attempts: int
    successes: int
    rate: float
    ci_low: float
    ci_high: float


def _wilson_interval(successes: int, attempts: int) -> Tuple[float, float]:
    """Wilson score interval at 95%. Returns ``(low, high)`` in [0, 1].

    Falls back to ``(0.0, 1.0)`` when ``attempts == 0`` — caller is responsible
    for not displaying an interval at zero sample size.
    """
    if attempts <= 0:
        return 0.0, 1.0
    n = attempts
    p_hat = successes / n
    z2 = _Z_95 * _Z_95
    denom = 1.0 + z2 / n
    centre = (p_hat + z2 / (2 * n)) / denom
    halfwidth = (_Z_95 * math.sqrt((p_hat * (1 - p_hat) + z2 / (4 * n)) / n)) / denom
    low = max(0.0, centre - halfwidth)
    high = min(1.0, centre + halfwidth)
    return low, high


def aggregate_retry_outcomes(
    records: Iterable[RetryOutcomeRecord],
) -> List[RetrySuccessStat]:
    """Aggregate per ``(question_id, explanation_version)``.

    Output is sorted (question_id, explanation_version) for stable test
    assertions and deterministic dashboards.
    """
    buckets: Dict[Tuple[str, str], List[bool]] = {}
    for r in records:
        if not r.question_id or not r.explanation_version:
            # Defensive: the event Pydantic models forbid empty strings, but
            # ad-hoc callers might still pass them. Skip rather than crash.
            continue
        buckets.setdefault((r.question_id, r.explanation_version), []).append(r.succeeded)

    out: List[RetrySuccessStat] = []
    for (qid, ver), flags in buckets.items():
        attempts = len(flags)
        successes = sum(1 for ok in flags if ok)
        rate = successes / attempts if attempts else 0.0
        low, high = _wilson_interval(successes, attempts)
        out.append(
            RetrySuccessStat(
                question_id=qid,
                explanation_version=ver,
                attempts=attempts,
                successes=successes,
                rate=rate,
                ci_low=low,
                ci_high=high,
            )
        )
    out.sort(key=lambda s: (s.question_id, s.explanation_version))
    return out


def detect_regressions(
    current: List[RetrySuccessStat],
    previous: List[RetrySuccessStat],
    *,
    drop_threshold_pp: float = 10.0,
    min_attempts: int = 30,
) -> List[Tuple[str, str, float]]:
    """Return ``(question_id, explanation_version, drop_pp)`` for any version
    whose rate dropped by more than ``drop_threshold_pp`` percentage points
    week-on-week. Skips versions below ``min_attempts`` in either window —
    small samples produce false alarms.

    Matches MVP §4.3: *auto-flag if any explanation_version drops >10pp WoW*.
    """
    prev_index = {(s.question_id, s.explanation_version): s for s in previous}
    out: List[Tuple[str, str, float]] = []
    for cur in current:
        key = (cur.question_id, cur.explanation_version)
        prev = prev_index.get(key)
        if prev is None:
            continue
        if cur.attempts < min_attempts or prev.attempts < min_attempts:
            continue
        drop = (prev.rate - cur.rate) * 100.0
        if drop > drop_threshold_pp:
            out.append((cur.question_id, cur.explanation_version, drop))
    out.sort(key=lambda t: t[2], reverse=True)
    return out
