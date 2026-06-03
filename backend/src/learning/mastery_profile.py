"""Aggregate a child's practice sessions into a learner mastery profile.

The learner profile page (``/profile``) renders a skill radar and a mastery
trajectory. Historically both were hard-coded demo fixtures. This module turns
the real per-session signal returned by
:meth:`StorageService.list_sessions_for_child` into:

* ``skills`` — one radar axis per distinct exercise the child has practised,
  scored by the mean ``overall_score`` across that exercise's sessions.
* ``trajectory`` — the weekly mean ``overall_score`` over the most recent weeks.

The function is intentionally storage-agnostic (it takes plain session dicts)
so it works identically against the SQLite and Postgres backends and is easy to
unit-test.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

__all__ = ["build_child_mastery"]

DEFAULT_TARGET = 75.0


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalise_score(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    # Some assessments may report a 0..1 fraction; scale those up.
    if 0.0 < score <= 1.0:
        score *= 100.0
    if score < 0.0:
        score = 0.0
    if score > 100.0:
        score = 100.0
    return score


def _metadata(session: Dict[str, Any]) -> Dict[str, Any]:
    exercise = session.get("exercise") or {}
    metadata = (
        session.get("exercise_metadata")
        or exercise.get("exerciseMetadata")
        or {}
    )
    return metadata if isinstance(metadata, dict) else {}


def _skill_label(session: Dict[str, Any]) -> str:
    metadata = _metadata(session)
    for key in ("skill", "topic"):
        candidate = metadata.get(key)
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    exercise = session.get("exercise") or {}
    name = exercise.get("name")
    if name and str(name).strip():
        return str(name).strip()
    return "Practice"


def _skill_target(sessions: Sequence[Dict[str, Any]]) -> float:
    thresholds: List[float] = []
    for session in sessions:
        raw = _metadata(session).get("masteryThreshold")
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if 0.0 < value <= 1.0:
            value *= 100.0
        thresholds.append(value)
    if not thresholds:
        return DEFAULT_TARGET
    return round(sum(thresholds) / len(thresholds))


def build_child_mastery(
    sessions: Sequence[Dict[str, Any]],
    *,
    max_skills: int = 12,
    trajectory_weeks: int = 6,
) -> Dict[str, Any]:
    """Build a mastery profile from a child's session history.

    ``sessions`` is the list returned by
    :meth:`StorageService.list_sessions_for_child`. Sessions without a usable
    ``overall_score`` are ignored. Returns a JSON-serialisable dict with
    ``has_data``, ``session_count``, ``skills`` and ``trajectory``.
    """
    total_sessions = len(sessions)

    by_skill: Dict[str, List[float]] = {}
    by_skill_sessions: Dict[str, List[Dict[str, Any]]] = {}
    weekly: Dict[Tuple[int, int], List[float]] = {}
    scored_count = 0

    for session in sessions:
        score = _normalise_score(session.get("overall_score"))
        if score is None:
            continue
        scored_count += 1

        label = _skill_label(session)
        by_skill.setdefault(label, []).append(score)
        by_skill_sessions.setdefault(label, []).append(session)

        timestamp = _parse_timestamp(session.get("timestamp"))
        if timestamp is not None:
            iso_year, iso_week, _ = timestamp.isocalendar()
            weekly.setdefault((iso_year, iso_week), []).append(score)

    skills: List[Dict[str, Any]] = []
    for label, scores in by_skill.items():
        if not scores:
            continue
        skills.append(
            {
                "skill": label,
                "mastery": round(sum(scores) / len(scores)),
                "target": _skill_target(by_skill_sessions[label]),
                "sessions": len(scores),
            }
        )

    # Surface the most-practised skills, then present them alphabetically so the
    # radar axis order is stable between requests.
    skills.sort(key=lambda item: (-item["sessions"], item["skill"].lower()))
    skills = skills[:max_skills]
    skills.sort(key=lambda item: item["skill"].lower())

    # Weekly trajectory: most recent ``trajectory_weeks`` weeks with data,
    # oldest -> newest, labelled W1..Wn.
    ordered_weeks = sorted(weekly.keys())[-trajectory_weeks:]
    trajectory: List[Dict[str, Any]] = []
    for index, key in enumerate(ordered_weeks, start=1):
        week_scores = weekly[key]
        trajectory.append(
            {
                "week": f"W{index}",
                "score": round(sum(week_scores) / len(week_scores)),
                "iso_year": key[0],
                "iso_week": key[1],
            }
        )

    return {
        "has_data": scored_count > 0,
        "session_count": total_sessions,
        "scored_session_count": scored_count,
        "skills": skills,
        "trajectory": trajectory,
    }
