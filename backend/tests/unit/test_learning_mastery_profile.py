"""Unit tests for the learner mastery-profile aggregator."""

from src.learning.mastery_profile import DEFAULT_TARGET, build_child_mastery


def _session(score, *, name="Ratio practice", timestamp="2026-05-01T10:00:00Z", metadata=None):
    return {
        "id": f"s-{name}-{timestamp}-{score}",
        "timestamp": timestamp,
        "overall_score": score,
        "exercise": {"name": name, "exerciseMetadata": metadata or {}},
    }


def test_empty_sessions_returns_no_data():
    result = build_child_mastery([])
    assert result["has_data"] is False
    assert result["session_count"] == 0
    assert result["scored_session_count"] == 0
    assert result["skills"] == []
    assert result["trajectory"] == []


def test_sessions_without_scores_are_ignored():
    result = build_child_mastery([_session(None), _session(None)])
    assert result["has_data"] is False
    assert result["session_count"] == 2
    assert result["scored_session_count"] == 0
    assert result["skills"] == []


def test_skill_is_mean_overall_score_per_exercise():
    sessions = [
        _session(60, name="Ratio practice"),
        _session(80, name="Ratio practice"),
        _session(50, name="Fractions"),
    ]
    result = build_child_mastery(sessions)
    skills = {s["skill"]: s for s in result["skills"]}
    assert skills["Ratio practice"]["mastery"] == 70
    assert skills["Ratio practice"]["sessions"] == 2
    assert skills["Fractions"]["mastery"] == 50
    assert skills["Ratio practice"]["target"] == DEFAULT_TARGET
    assert result["has_data"] is True
    assert result["scored_session_count"] == 3


def test_skill_label_prefers_metadata_skill_then_topic():
    sessions = [
        _session(70, name="Generic", metadata={"skill": "Ratio & proportion"}),
        _session(70, name="Generic", metadata={"topic": "Linear equations"}),
    ]
    labels = {s["skill"] for s in build_child_mastery(sessions)["skills"]}
    assert "Ratio & proportion" in labels
    assert "Linear equations" in labels


def test_mastery_threshold_metadata_sets_target():
    sessions = [
        _session(70, name="Ratio", metadata={"masteryThreshold": 90}),
        _session(80, name="Ratio", metadata={"masteryThreshold": 90}),
    ]
    skill = build_child_mastery(sessions)["skills"][0]
    assert skill["target"] == 90


def test_fractional_scores_are_scaled_to_percent():
    result = build_child_mastery([_session(0.6, name="Ratio")])
    assert result["skills"][0]["mastery"] == 60


def test_trajectory_groups_by_week_oldest_to_newest():
    sessions = [
        _session(40, timestamp="2026-04-06T09:00:00Z"),  # ISO week 15
        _session(60, timestamp="2026-04-08T09:00:00Z"),  # ISO week 15
        _session(90, timestamp="2026-04-13T09:00:00Z"),  # ISO week 16
    ]
    trajectory = build_child_mastery(sessions)["trajectory"]
    assert [t["week"] for t in trajectory] == ["W1", "W2"]
    assert trajectory[0]["score"] == 50  # mean of 40, 60
    assert trajectory[1]["score"] == 90


def test_skills_capped_and_sorted_alphabetically():
    sessions = [
        _session(70, name=f"Skill {chr(ord('A') + i)}") for i in range(15)
    ]
    result = build_child_mastery(sessions, max_skills=5)
    assert len(result["skills"]) == 5
    labels = [s["skill"] for s in result["skills"]]
    assert labels == sorted(labels, key=str.lower)


def test_trajectory_limited_to_recent_weeks():
    sessions = [
        _session(50, timestamp=f"2026-0{month}-06T09:00:00Z")
        for month in range(1, 9)
    ]
    trajectory = build_child_mastery(sessions, trajectory_weeks=3)["trajectory"]
    assert len(trajectory) == 3
    assert [t["week"] for t in trajectory] == ["W1", "W2", "W3"]
