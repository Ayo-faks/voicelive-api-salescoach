"""Unit coverage for learner goal validation (guided-then-freeform intake).

Exercises ``profile_config.normalise_goal`` / ``normalise_goals`` and the
``goals`` branch of ``validate_patch``: structured fields, the skip/empty
rejection rule, enum gating, and the per-list cap.
"""

from __future__ import annotations

from src.learning.profile_config import (
    MAX_GOALS,
    normalise_goal,
    normalise_goals,
    validate_patch,
)


def test_goal_with_subject_only_is_valid():
    cleaned = normalise_goal({"subject": "Maths"})
    assert cleaned == {"subject": "Maths"}


def test_goal_keeps_note_and_created_at():
    cleaned = normalise_goal(
        {
            "subject": "English",
            "exam": "WAEC",
            "target_date": "this_term",
            "note": "I struggle with comprehension",
            "created_at": "2026-06-05T00:00:00+00:00",
        }
    )
    assert cleaned == {
        "subject": "English",
        "exam": "WAEC",
        "target_date": "this_term",
        "note": "I struggle with comprehension",
        "created_at": "2026-06-05T00:00:00+00:00",
    }


def test_goal_without_biasing_signal_is_rejected():
    # A note on its own carries no planner signal -> not a storable goal.
    assert normalise_goal({"note": "just exploring"}) is None
    assert normalise_goal({}) is None


def test_goal_rejects_unknown_exam_and_timeframe():
    assert normalise_goal({"exam": "SAT"}) is None
    assert normalise_goal({"subject": "Maths", "target_date": "next_week"}) is None


def test_goal_drops_empty_note_but_keeps_signal():
    cleaned = normalise_goal({"subject": "Maths", "note": "   "})
    assert cleaned == {"subject": "Maths"}


def test_normalise_goals_enforces_cap():
    too_many = [{"subject": "Maths"} for _ in range(MAX_GOALS + 1)]
    assert normalise_goals(too_many) is None

    at_cap = [{"subject": "Maths"} for _ in range(MAX_GOALS)]
    assert normalise_goals(at_cap) is not None


def test_validate_patch_accepts_goals():
    cleaned, error = validate_patch(
        {"goals": [{"subject": "Maths", "exam": "WAEC", "target_date": "this_year"}]}
    )
    assert error is None
    assert cleaned["goals"] == [
        {"subject": "Maths", "exam": "WAEC", "target_date": "this_year"}
    ]


def test_validate_patch_rejects_bad_goal():
    cleaned, error = validate_patch({"goals": [{"note": "no signal"}]})
    assert cleaned == {}
    assert error is not None
    assert "goals" in error
