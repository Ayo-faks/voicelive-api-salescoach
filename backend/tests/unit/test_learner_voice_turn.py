"""Tests for the learner fullscreen voice + gen-UI deterministic planner."""

from __future__ import annotations

import pytest

from src.learning.learner_voice import (
    ExplanationCard,
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
    McqTapCard,
    ProgressCard,
)


def _req(**kwargs):
    payload = {"child_id": "stu-1"}
    payload.update(kwargs)
    return LearnerVoiceTurnRequest(**payload)


def test_first_turn_returns_mcq_card_with_greeting_in_speech():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(_req())
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.kind == "mcq-tap"
    assert len(resp.card.options) == 4
    assert "Hi" in resp.card.speak
    assert resp.session_complete is False


def test_correct_answer_advances_to_next_question():
    planner = LearnerVoiceTurnPlanner()
    first = planner.next_turn(_req())
    assert isinstance(first.card, McqTapCard)

    resp = planner.next_turn(
        _req(
            last_card_id=first.card.card_id,
            last_kind="mcq-tap",
            answer_option_id="c",  # Q1 correct answer per scripted bank
        )
    )
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.card_id != first.card.card_id


def test_wrong_answer_returns_explanation_card():
    planner = LearnerVoiceTurnPlanner()
    first = planner.next_turn(_req())
    assert isinstance(first.card, McqTapCard)

    resp = planner.next_turn(
        _req(
            last_card_id=first.card.card_id,
            last_kind="mcq-tap",
            answer_option_id="a",  # wrong
        )
    )
    assert isinstance(resp.card, ExplanationCard)
    assert resp.card.steps
    assert resp.session_complete is False


def test_explanation_then_advance_yields_next_question():
    planner = LearnerVoiceTurnPlanner()
    q1 = planner.next_turn(_req())
    expl = planner.next_turn(
        _req(last_card_id=q1.card.card_id, last_kind="mcq-tap", answer_option_id="a")
    )
    nxt = planner.next_turn(
        _req(last_card_id=expl.card.card_id, last_kind="explanation", advance=True)
    )
    assert isinstance(nxt.card, McqTapCard)


def test_full_correct_walkthrough_completes_session():
    planner = LearnerVoiceTurnPlanner()
    correct_answers = ["c", "b", "b"]
    resp = planner.next_turn(_req())
    for answer in correct_answers:
        assert isinstance(resp.card, McqTapCard)
        resp = planner.next_turn(
            _req(
                last_card_id=resp.card.card_id,
                last_kind="mcq-tap",
                answer_option_id=answer,
            )
        )
    assert isinstance(resp.card, ProgressCard)
    assert resp.session_complete is True
    assert resp.card.completed == resp.card.total


def test_invalid_payload_missing_child_id_raises():
    with pytest.raises(Exception):
        LearnerVoiceTurnRequest(child_id="")
