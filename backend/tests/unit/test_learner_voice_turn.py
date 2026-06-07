"""Tests for the learner fullscreen voice + gen-UI deterministic planner."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.learning.api import ITEM_BANK_PATH, LearningApi
from src.learning.diagnostic import load_item_bank
from src.learning.learner_voice import (
    ExplanationCard,
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
    MarkKnownCard,
    McqTapCard,
    ProgressCard,
    normalize_class_year,
)


def _req(**kwargs):
    payload = {"child_id": "stu-1"}
    payload.update(kwargs)
    return LearnerVoiceTurnRequest(**payload)


@pytest.fixture()
def learning_api() -> LearningApi:
    assert ITEM_BANK_PATH.exists(), f"item bank fixture missing at {ITEM_BANK_PATH}"
    return LearningApi(item_bank=load_item_bank(Path(ITEM_BANK_PATH)))


# ---------------------------------------------------------------------------
# class_year normalisation (profile SS2 -> planner SSS2)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw, canonical",
    [
        # Senior secondary: profile double-S -> planner triple-S.
        ("SS1", "SSS1"),
        ("SS2", "SSS2"),
        ("SS3", "SSS3"),
        # Lower-case and whitespace/long-form spellings.
        ("ss3", "SSS3"),
        ("  SS3  ", "SSS3"),
        ("Senior Secondary 3", "SSS3"),
        ("senior secondary 1", "SSS1"),
        # Already-canonical triple-S is a no-op.
        ("SSS1", "SSS1"),
        ("SSS3", "SSS3"),
        # Junior secondary is unaffected.
        ("JSS2", "JSS2"),
        ("JSS3", "JSS3"),
        ("jss3", "JSS3"),
    ],
)
def test_normalize_class_year_maps_every_spelling(raw, canonical):
    assert normalize_class_year(raw) == canonical


@pytest.mark.parametrize("bad", ["", "  ", "SS9", "Grade 12", "primary 6"])
def test_normalize_class_year_passes_unknown_through(bad):
    # Unknown/empty input is returned unchanged so the ClassYear Literal still
    # rejects genuinely invalid classes instead of silently masking them.
    assert normalize_class_year(bad) == bad


def test_normalize_class_year_ignores_non_string():
    assert normalize_class_year(None) is None


@pytest.mark.parametrize(
    "raw, canonical",
    [("SS1", "SSS1"), ("SS2", "SSS2"), ("SS3", "SSS3"), ("ss3", "SSS3"),
     ("Senior Secondary 3", "SSS3"), ("SSS3", "SSS3"), ("JSS3", "JSS3")],
)
def test_request_model_canonicalises_class_year(raw, canonical):
    # The pydantic model normalises before the Literal check, so the senior
    # double-S spelling stored on the learner profile is accepted on every
    # voice/turn path that builds a LearnerVoiceTurnRequest.
    assert _req(class_year=raw).class_year == canonical


def test_request_model_rejects_truly_invalid_class_year():
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        _req(class_year="SS9")


def test_run_voice_turn_normalises_profile_year_group(learning_api: LearningApi):
    # The learner profile stores "SS2"; the planner enum wants "SSS2". The turn
    # must succeed (open the first card) instead of 400ing — this is the bug
    # goal-intake "Start now" exposed when it forwarded the raw profile year.
    turn = learning_api.run_learner_voice_turn(
        {
            "child_id": "stu-1",
            "exam": "WAEC",
            "class_year": "SS2",
            "subject": "Mathematics",
            "skill_id": "differentiation",
        }
    )
    card = turn.get("card")
    assert card is not None
    assert card.get("kind") == "mcq-tap"
    # The forced skill leads the walkthrough.
    assert card.get("skill_id") == "differentiation"


@pytest.mark.parametrize(
    "raw_year",
    ["SS1", "SS2", "SS3", "ss3", "Senior Secondary 3"],
)
def test_run_voice_turn_starts_for_every_senior_spelling(
    learning_api: LearningApi, raw_year: str
):
    # SS3 (and the rest of the senior band, in any spelling) must open a real
    # MCQ card instead of reporting the class as "not in the right format".
    turn = learning_api.run_learner_voice_turn(
        {
            "child_id": "stu-1",
            "exam": "WAEC",
            "class_year": raw_year,
            "subject": "Mathematics",
        }
    )
    card = turn.get("card")
    assert card is not None
    assert card.get("kind") == "mcq-tap"


@pytest.mark.parametrize("raw_year", ["JSS2", "JSS3"])
def test_run_voice_turn_junior_classes_unaffected(
    learning_api: LearningApi, raw_year: str
):
    turn = learning_api.run_learner_voice_turn(
        {
            "child_id": "stu-1",
            "exam": "Junior WAEC",
            "class_year": raw_year,
            "subject": "Mathematics",
        }
    )
    assert turn.get("card") is not None


def test_run_voice_turn_accepts_already_canonical_year(learning_api: LearningApi):
    turn = learning_api.run_learner_voice_turn(
        {
            "child_id": "stu-1",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        }
    )
    assert turn.get("card") is not None



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
# Forced lead skill (goal intake "Start now")
# ---------------------------------------------------------------------------

def test_forced_skill_leads_the_walkthrough():
    planner = LearnerVoiceTurnPlanner()
    # Default Mathematics order is differentiation -> trigonometry -> mean.
    # Forcing "trigonometry" must promote it to the first card.
    resp = planner.next_turn(_req(skill_id="trigonometry"))
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.skill_id == "trigonometry"


def test_forced_skill_keeps_a_coherent_forward_sequence():
    planner = LearnerVoiceTurnPlanner()
    first = planner.next_turn(_req(skill_id="trigonometry"))
    assert isinstance(first.card, McqTapCard)
    assert first.card.skill_id == "trigonometry"
    # Correct answer (hypotenuse = 10 cm) advances to the next, distinct card.
    second = planner.next_turn(
        _req(
            skill_id="trigonometry",
            last_card_id=first.card.card_id,
            last_kind="mcq-tap",
            answer_option_id="b",
        )
    )
    assert isinstance(second.card, McqTapCard)
    assert second.card.skill_id != "trigonometry"


def test_unknown_forced_skill_falls_back_to_default_order():
    planner = LearnerVoiceTurnPlanner()
    # A skill that does not exist in this taxonomy is ignored, not an error.
    resp = planner.next_turn(_req(skill_id="not-a-real-skill"))
    assert isinstance(resp.card, McqTapCard)
    assert resp.card.skill_id == "differentiation"


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
