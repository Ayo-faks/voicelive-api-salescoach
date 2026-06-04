"""A8–A13 — consolidated agent-coverage probe suites.

Validates the per-agent offline probe suites added in Track A increments A8–A13:

* A8  text tutor          (``text_tutor_probes``)
* A9  voice tutor         (``voice_tutor_probes``)
* A10 voice profile tools (``voice_profile_probes``)
* A11 insights agent      (``insights_probes``)        — dirty file, adapter-only
* A12 planning service    (``planning_probes``)        — dirty file, adapter-only
* A13 safeguarding LLM    (``safeguarding_classifier_probes``) — drives REAL parser

For every suite we assert the same three invariants:

1.  **Dark-by-default** — ``default_probes()`` raises its own
    ``*Unavailable`` error when the per-suite flag is unset.
2.  **Green under flag** — with the harness flag + per-suite flag set, the
    fixture handler passes every probe through ``run_suite`` (Tier-1 thresholds
    met, no critical failures, no safeguarding misses).
3.  **Flag-gated** — ``default_probes(require_flag=False)`` returns the static
    probe tuple regardless of environment.
"""

from __future__ import annotations

import pytest

from src.learning.eval.harness import EVAL_HARNESS_FLAG, run_suite

from src.learning.eval import (
    text_tutor_probes,
    voice_tutor_probes,
    voice_profile_probes,
    insights_probes,
    planning_probes,
    safeguarding_classifier_probes,
)

# (module, per-suite flag, unavailable-error, handler-class, suite_id)
_SUITES = [
    (
        text_tutor_probes,
        text_tutor_probes.TEXT_TUTOR_PROBES_FLAG,
        text_tutor_probes.TextTutorProbesUnavailableError,
        text_tutor_probes.text_tutor_fixture_handler,
        "a8-text-tutor",
    ),
    (
        voice_tutor_probes,
        voice_tutor_probes.VOICE_TUTOR_PROBES_FLAG,
        voice_tutor_probes.VoiceTutorProbesUnavailableError,
        voice_tutor_probes.voice_tutor_fixture_handler,
        "a9-voice-tutor",
    ),
    (
        voice_profile_probes,
        voice_profile_probes.VOICE_PROFILE_PROBES_FLAG,
        voice_profile_probes.VoiceProfileProbesUnavailableError,
        voice_profile_probes.voice_profile_fixture_handler,
        "a10-voice-profile",
    ),
    (
        insights_probes,
        insights_probes.INSIGHTS_PROBES_FLAG,
        insights_probes.InsightsProbesUnavailableError,
        insights_probes.insights_fixture_handler,
        "a11-insights",
    ),
    (
        planning_probes,
        planning_probes.PLANNING_PROBES_FLAG,
        planning_probes.PlanningProbesUnavailableError,
        planning_probes.planning_fixture_handler,
        "a12-planning",
    ),
    (
        safeguarding_classifier_probes,
        safeguarding_classifier_probes.SAFEGUARDING_CLASSIFIER_PROBES_FLAG,
        safeguarding_classifier_probes.SafeguardingClassifierProbesUnavailableError,
        safeguarding_classifier_probes.safeguarding_classifier_fixture_handler,
        "a13-safeguarding-classifier",
    ),
]

_IDS = [s[4] for s in _SUITES]


@pytest.fixture(autouse=True)
def _clear_flags(monkeypatch):
    for _mod, flag, _err, _handler, _sid in _SUITES:
        monkeypatch.delenv(flag, raising=False)
    monkeypatch.delenv(EVAL_HARNESS_FLAG, raising=False)
    yield


@pytest.mark.parametrize("suite", _SUITES, ids=_IDS)
def test_default_probes_dark_by_default(suite):
    mod, _flag, err, _handler, _sid = suite
    with pytest.raises(err):
        mod.default_probes()


@pytest.mark.parametrize("suite", _SUITES, ids=_IDS)
def test_default_probes_flag_bypass_returns_static_tuple(suite):
    mod, _flag, _err, _handler, _sid = suite
    probes = mod.default_probes(require_flag=False)
    assert isinstance(probes, tuple)
    assert len(probes) >= 3
    assert all(p.probe_id for p in probes)


@pytest.mark.parametrize("suite", _SUITES, ids=_IDS)
def test_handler_passes_every_probe(monkeypatch, suite):
    mod, flag, _err, handler_cls, suite_id = suite
    monkeypatch.setenv(EVAL_HARNESS_FLAG, "1")
    monkeypatch.setenv(flag, "1")

    probes = mod.default_probes()
    report = run_suite(handler_cls(), probes, suite_id=suite_id)

    assert len(report.results) == len(probes)
    failures = [
        (r.probe_id, r.expected, r.outcome) for r in report.results if not r.passed
    ]
    assert failures == []
    assert report.passed is True
    assert report.counts.get("safeguarding_failures", 0) == 0
