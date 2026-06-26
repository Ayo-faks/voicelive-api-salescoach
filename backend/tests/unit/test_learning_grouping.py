from src.learning.grouping import build_differentiation_groups


def test_build_differentiation_groups_covers_teacher_support_types():
    groups = build_differentiation_groups(
        [
            {
                "student_id": "student-reteach",
                "skill_id": "ratio",
                "skill_label": "Ratio reasoning",
                "probability": 0.32,
                "uncertainty": 0.22,
                "status": "needs_support",
            },
            {
                "student_id": "student-practice",
                "skill_id": "ratio",
                "skill_label": "Ratio reasoning",
                "probability": 0.52,
                "uncertainty": 0.31,
                "status": "needs_support",
            },
            {
                "student_id": "student-review",
                "skill_id": "ratio",
                "skill_label": "Ratio reasoning",
                "probability": 0.62,
                "uncertainty": 0.48,
                "status": "developing",
            },
            {
                "student_id": "student-monitor",
                "skill_id": "ratio",
                "skill_label": "Ratio reasoning",
                "probability": 0.66,
                "uncertainty": 0.24,
                "status": "developing",
            },
            {
                "student_id": "student-extension",
                "skill_id": "ratio",
                "skill_label": "Ratio reasoning",
                "probability": 0.84,
                "uncertainty": 0.19,
                "status": "secure",
            },
        ]
    )

    support_types = {group["support_type"] for group in groups}
    assert support_types == {"reteach", "targeted_practice", "review", "monitor", "extension"}
    assert all(group["rationale"] for group in groups)
    assert all(group["target_skill_id"] == "ratio" for group in groups)
    assert all(group["confidence"] <= 1 for group in groups)