"""Tests for the learner fullscreen voice + gen-UI deterministic planner."""

from __future__ import annotations

import pytest

from src.learning.learner_voice import (
    ExplanationCard,
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
    MarkKnownCard,
    McqTapCard,
    ProgressCard,
)


def _req(**kwargs):
    payload = {"child_id": "stu-1"}
    payload.update(kwargs)
    return LearnerVoiceTurnRequest(**payload)


# ---------------------------------------------------------------------------
# Default (WAEC SSS2 Mathematics) flow
# ---------------------------------------------------------------------------

def test_first_turn_returns_mcq_card_with_greeting_in_speech():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(_req())
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.kind == "mcq-tap"
    assert len(resp.card.options) == 4
    assert "Hi" in resp.card.speak
    # Default greeting must name the chosen taxonomy.
    assert "Mathematics" in resp.card.speak
    assert "SSS2" in resp.card.speak
    assert resp.session_complete is False


def test_correct_answer_advances_to_next_question():
    planner = LearnerVoiceTurnPlanner()
    first = planner.next_turn(_req())
    assert isinstance(first.card, McqTapCard)

    resp = planner.next_turn(
        _req(
            last_card_id=first.card.card_id,
            last_kind="mcq-tap",
            answer_option_id="b",  # Q1 differentiate -> 6x + 4
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


def test_full_correct_walkthrough_completes_session_for_default_taxonomy():
    planner = LearnerVoiceTurnPlanner()
    # Default WAEC SSS2 Mathematics answers: differentiate, trig, mean.
    correct_answers = ["b", "b", "b"]
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


# ---------------------------------------------------------------------------
# Taxonomy filtering
# ---------------------------------------------------------------------------

def test_jss2_mathematics_walkthrough_contains_only_maths_skills():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(
        _req(exam="Junior WAEC", class_year="JSS2", subject="Mathematics")
    )
    assert isinstance(resp.card, McqTapCard)
    seen_skills: list[str] = [resp.card.skill_id]
    last = resp
    for correct in ("c", "b", "b"):  # JSS2 Maths: ratio, fractions, percentages
        last = planner.next_turn(
            _req(
                exam="Junior WAEC",
                class_year="JSS2",
                subject="Mathematics",
                last_card_id=last.card.card_id,
                last_kind="mcq-tap",
                answer_option_id=correct,
            )
        )
        if isinstance(last.card, McqTapCard):
            seen_skills.append(last.card.skill_id)
    assert set(seen_skills) <= {
        "ratio-proportion",
        "fraction-operations",
        "percentage-basics",
    }, seen_skills
    # The English reading-inference skill must never appear in a Maths session.
    assert "reading-inference" not in seen_skills


def test_jss2_english_walkthrough_returns_english_skills_only():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(
        _req(exam="Junior WAEC", class_year="JSS2", subject="English Language")
    )
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.skill_id in {
        "subject-verb-agreement",
        "vocabulary-synonyms",
        "reading-inference",
    }
    assert resp.card.skill_id not in {"ratio-proportion", "fraction-operations"}


def test_jss2_basic_science_walkthrough_returns_science_skills_only():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(
        _req(exam="Junior WAEC", class_year="JSS2", subject="Basic Science")
    )
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.skill_id in {
        "energy-sources",
        "photosynthesis",
        "states-of-matter",
    }


def test_jamb_jss2_returns_invalid_combination_card():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(
        _req(exam="JAMB", class_year="JSS2", subject="Mathematics")
    )
    assert isinstance(resp.card, MarkKnownCard)
    assert "JAMB" in resp.card.prompt
    assert "JSS2" in resp.card.prompt


def test_junior_waec_sss3_returns_invalid_combination_card():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(
        _req(exam="Junior WAEC", class_year="SSS3", subject="Mathematics")
    )
    assert isinstance(resp.card, MarkKnownCard)
    assert "Junior WAEC" in resp.card.prompt


def test_two_concurrent_taxonomies_do_not_share_card_ids():
    planner = LearnerVoiceTurnPlanner()
    maths = planner.next_turn(
        _req(exam="Junior WAEC", class_year="JSS2", subject="Mathematics")
    )
    english = planner.next_turn(
        _req(exam="Junior WAEC", class_year="JSS2", subject="English Language")
    )
    assert isinstance(maths.card, McqTapCard)
    assert isinstance(english.card, McqTapCard)
    assert maths.card.skill_id != english.card.skill_id
    assert maths.card.card_id != english.card.card_id


def test_sss3_jamb_mathematics_walkthrough_uses_sss3_maths_bank():
    planner = LearnerVoiceTurnPlanner()
    resp = planner.next_turn(_req(exam="JAMB", class_year="SSS3", subject="Mathematics"))
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.skill_id in {
        "integration",
        "probability",
        "arithmetic-progression",
    }
