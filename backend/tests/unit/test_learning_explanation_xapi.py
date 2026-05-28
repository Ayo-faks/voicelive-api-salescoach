"""Tests for retry-after-explanation xAPI converters (W3-A)."""

from __future__ import annotations

from src.learning.models import Provenance
from src.learning.xapi import (
    ExplanationViewedEvent,
    QuestionRetriedEvent,
    RetryOutcomeEvent,
    explanation_viewed_event_to_xapi,
    question_retried_event_to_xapi,
    retry_outcome_event_to_xapi,
)


PROV = [Provenance(source="agent:explanation", confidence=0.9, evidence_count=1)]


def test_explanation_viewed_event_to_xapi_shape() -> None:
    event = ExplanationViewedEvent(
        lang="en",
        provenance=PROV,
        tenant_id="t-1",
        student_id="s-1",
        question_id="maths-v1-jss3-006",
        skill_id="jss3.number.fractions",
        explanation_id="exp-abc",
        explanation_version="exp-fractions-1.0.0",
    )
    stmt = explanation_viewed_event_to_xapi(event)
    assert stmt.verb["id"].endswith("/experienced")
    assert stmt.object["id"].endswith("/explanations/exp-abc")
    ext = stmt.result["extensions"]
    assert ext["https://pathfinder.learn/extensions/question_id"] == "maths-v1-jss3-006"
    assert ext["https://pathfinder.learn/extensions/explanation_version"] == "exp-fractions-1.0.0"


def test_question_retried_event_to_xapi_shape() -> None:
    event = QuestionRetriedEvent(
        lang="en",
        provenance=PROV,
        tenant_id="t-1",
        student_id="s-1",
        question_id="q-1",
        skill_id="sk-1",
        explanation_version="exp-1.0.0",
        attempt_number=2,
    )
    stmt = question_retried_event_to_xapi(event)
    assert stmt.verb["id"].endswith("/retried-question")
    assert stmt.object["id"].endswith("/questions/q-1")
    assert stmt.result["extensions"]["https://pathfinder.learn/extensions/attempt_number"] == 2


def test_retry_outcome_passed_uses_passed_verb() -> None:
    event = RetryOutcomeEvent(
        lang="en",
        provenance=PROV,
        tenant_id="t-1",
        student_id="s-1",
        question_id="q-1",
        skill_id="sk-1",
        explanation_version="exp-1.0.0",
        succeeded=True,
    )
    stmt = retry_outcome_event_to_xapi(event)
    assert stmt.verb["id"].endswith("/passed")
    assert stmt.result["success"] is True


def test_retry_outcome_failed_uses_failed_verb() -> None:
    event = RetryOutcomeEvent(
        lang="en",
        provenance=PROV,
        tenant_id="t-1",
        student_id="s-1",
        question_id="q-1",
        skill_id="sk-1",
        explanation_version="exp-1.0.0",
        succeeded=False,
    )
    stmt = retry_outcome_event_to_xapi(event)
    assert stmt.verb["id"].endswith("/failed")
    assert stmt.result["success"] is False
