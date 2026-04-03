"""Validation helpers for structured therapist practice plans."""

from __future__ import annotations

from typing import Any, Dict, List


def _normalize_string(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _normalize_string_list(value: Any, fallback: List[str]) -> List[str]:
    if not isinstance(value, list):
        return fallback

    items = [str(item).strip() for item in value if str(item).strip()]
    return items or fallback


def _normalize_minutes(value: Any, fallback: int, minimum: int) -> int:
    try:
        if isinstance(value, str):
            digits = "".join(character for character in value if character.isdigit())
            if digits:
                return max(minimum, int(digits))
            return max(minimum, fallback)

        return max(minimum, int(value))
    except (TypeError, ValueError):
        return max(minimum, fallback)


def normalize_plan_draft(draft: Dict[str, Any]) -> Dict[str, Any]:
    activities_input = draft.get("activities") if isinstance(draft.get("activities"), list) else []
    activities: List[Dict[str, Any]] = []

    for activity in activities_input:
        if not isinstance(activity, dict):
            continue

        activities.append(
            {
                "title": _normalize_string(activity.get("title"), "Practice activity"),
                "exercise_id": _normalize_string(activity.get("exercise_id"), "custom-guided-practice"),
                "exercise_name": _normalize_string(activity.get("exercise_name"), "Guided practice"),
                "reason": _normalize_string(activity.get("reason"), "Supports the current speech target."),
                "target_duration_minutes": _normalize_minutes(activity.get("target_duration_minutes"), 5, 3),
            }
        )

    if not activities:
        activities = [
            {
                "title": "Warm-up practice",
                "exercise_id": "custom-guided-practice",
                "exercise_name": "Guided practice",
                "reason": "Provides a safe starting point for the next session.",
                "target_duration_minutes": 5,
            }
        ]

    return {
        "objective": _normalize_string(draft.get("objective"), "Build confidence on the next speech target."),
        "focus_sound": _normalize_string(draft.get("focus_sound"), "target sound"),
        "rationale": _normalize_string(
            draft.get("rationale"),
            "Use the previous session outcome to focus the next practice block.",
        ),
        "estimated_duration_minutes": _normalize_minutes(draft.get("estimated_duration_minutes"), 15, 10),
        "activities": activities,
        "therapist_cues": _normalize_string_list(
            draft.get("therapist_cues"),
            ["Model the target once, then prompt the child to retry with encouragement."],
        ),
        "success_criteria": _normalize_string_list(
            draft.get("success_criteria"),
            ["Child attempts the target consistently with reduced prompting."],
        ),
        "carryover": _normalize_string_list(
            draft.get("carryover"),
            ["Repeat one short practice activity at home with a familiar word set."],
        ),
    }