"""Unit coverage for the exam-prep topic catalogue.

Exercises ``LearningApi.build_exam_prep_topics`` (the full per-subject topic
breakdown the exam-prep library binds to), the slug-normalised subject
resolution it relies on, and the targeted-practice path that serves a specific
topic's items even when it falls outside the round-robin diagnostic sample.
"""

from __future__ import annotations

import pytest

from src.learning.api import LearningApi


@pytest.fixture()
def learning_api() -> LearningApi:
    return LearningApi()


def test_catalogue_groups_real_topics_by_subject(learning_api: LearningApi):
    catalogue = learning_api.build_exam_prep_topics()

    assert catalogue["subject_count"] == len(catalogue["subjects"])
    assert catalogue["topic_count"] == len(catalogue["topics"])

    subjects = {entry["subject"]: entry for entry in catalogue["subjects"]}
    # The rich WAEC / NECO banks must be present and far deeper than the
    # static 2-3 item teaser the client ships as a fallback.
    for slug in ("mathematics", "physics", "biology", "chemistry", "english"):
        assert slug in subjects, f"{slug} missing from catalogue"
        assert subjects[slug]["topic_count"] >= 10
        assert subjects[slug]["skill_count"] >= subjects[slug]["topic_count"]

    # The thin JSS2 / pilot phase-2 fixtures must be excluded.
    for slug in ("general", "basic_science", "social_studies", "ict"):
        assert slug not in subjects


def test_every_topic_is_well_formed_and_resolvable(learning_api: LearningApi):
    catalogue = learning_api.build_exam_prep_topics()

    assert catalogue["topics"], "expected a non-empty topic catalogue"
    for topic in catalogue["topics"]:
        for field in (
            "id",
            "title",
            "subject",
            "subject_label",
            "topic",
            "topic_label",
            "year",
            "exam",
            "skill_id",
            "diagnostic_subject",
        ):
            assert topic[field], f"topic {topic['id']} missing {field}"
        # Only graded exam content is surfaced.
        assert topic["exam"] in {"JSSCE", "WAEC/NECO"}
        assert topic["year"] in {"JSS3", "SS3"}
        assert topic["skill_count"] >= 1
        # The advertised subject must round-trip through bank resolution so
        # the client can replay the topic via /diagnostic/start.
        bank = learning_api._resolve_bank({"subject": topic["diagnostic_subject"]})
        assert any(
            skill.skill_id == topic["skill_id"] for skill in bank.skills
        )


def test_topic_exposes_its_drillable_skill_list(learning_api: LearningApi):
    catalogue = learning_api.build_exam_prep_topics()

    for topic in catalogue["topics"]:
        skills = topic["skills"]
        # Every topic carries the full skill breakdown the client drills into.
        assert isinstance(skills, list)
        assert len(skills) == topic["skill_count"]
        skill_ids = [skill["skill_id"] for skill in skills]
        for skill in skills:
            assert skill["skill_id"], f"topic {topic['id']} skill missing id"
            assert skill["label"], f"topic {topic['id']} skill missing label"
        # The representative skill_id is one of the drillable skills, and each
        # skill resolves through the topic's bank so it can be practised.
        assert topic["skill_id"] in skill_ids
        bank = learning_api._resolve_bank({"subject": topic["diagnostic_subject"]})
        bank_skill_ids = {skill.skill_id for skill in bank.skills}
        for skill_id in skill_ids:
            assert skill_id in bank_skill_ids


def test_subject_slug_aliases_resolve_to_banks(learning_api: LearningApi):
    # "mathematics" has no exact bank key, so it resolves via the slug alias.
    maths = learning_api._resolve_bank({"subject": "mathematics"})
    assert maths.subject == "maths-jss3-ss3"

    physics = learning_api._resolve_bank({"subject": "physics"})
    assert physics.subject == "physics"

    # The English catalogue advertises the full SS3 bank key, which exact-matches
    # the rich exam bank (not the small JSS2 phase-2 fixture).
    catalogue = learning_api.build_exam_prep_topics()
    english_topic = next(
        topic for topic in catalogue["topics"] if topic["subject"] == "english"
    )
    assert english_topic["diagnostic_subject"] == "english-jss3-ss3"
    english = learning_api._resolve_bank(
        {"subject": english_topic["diagnostic_subject"]}
    )
    assert english.subject == "english-jss3-ss3"


def test_targeted_topic_practice_serves_that_skill(learning_api: LearningApi):
    catalogue = learning_api.build_exam_prep_topics()
    physics = next(
        entry for entry in catalogue["subjects"] if entry["subject"] == "physics"
    )
    # Pick a deep topic that is unlikely to land in the round-robin sample.
    topic = physics["topics"][-1]

    result = learning_api.start_diagnostic(
        {
            "subject": topic["diagnostic_subject"],
            "skill_id": topic["skill_id"],
            "student_id": "exam-prep-learner",
        }
    )

    assert result["item"] is not None
    assert result["item"]["skill_id"] == topic["skill_id"]


def test_multi_skill_topic_session_interleaves_all_topic_skills(
    learning_api: LearningApi,
):
    catalogue = learning_api.build_exam_prep_topics()
    # Find any topic that genuinely spans several distinct, bank-backed skills.
    topic = next(
        entry
        for entry in catalogue["topics"]
        if len({skill["skill_id"] for skill in entry["skills"]}) >= 3
    )
    skill_ids = [skill["skill_id"] for skill in topic["skills"]]

    result = learning_api.start_diagnostic(
        {
            "subject": topic["diagnostic_subject"],
            "skill_ids": skill_ids,
            "item_count": 12,
            "student_id": "exam-prep-learner",
        }
    )

    assert result["item"] is not None
    assert result["items_total"] >= 1

    state = learning_api._sessions[result["session_id"]]
    served = [item.skill_id for item in state.selected_items]
    # Every served item belongs to the topic's skill set.
    assert set(served).issubset(set(skill_ids))
    # The session genuinely mixes more than one skill (not a single-skill block).
    assert len({sid for sid in served}) >= 2
    # Round-robin: the first items step across distinct skills rather than
    # repeating one skill before moving on.
    distinct_skills_available = {
        item.skill_id
        for item in state.bank.items
        if item.skill_id in set(skill_ids)
    }
    assert served[0] != served[1] or len(distinct_skills_available) == 1
