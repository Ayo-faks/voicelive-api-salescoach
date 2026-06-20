"""HTTP + unit coverage for the unified ``/api/learning/assistant/turn`` route.

This is the merged voice+chat keystone: one endpoint returns the shared
``AssistantBlock`` contract for every modality. These tests run against the
deterministic brains (no Azure), so they assert routing and block shape, not
model wording.
"""

from __future__ import annotations

from typing import Any, Dict

import pytest
from flask import Flask

from src.config import reload_config
from src.learning.api import LearningApi, register_learning_api


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("PATHFINDER_ASSISTANT_LLM_ENABLED", "false")
    reload_config()
    api = LearningApi()
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    try:
        yield app.test_client()
    finally:
        reload_config()


def _turn(client: Any, body: Dict[str, Any]):
    return client.post("/api/learning/assistant/turn", json=body)


def test_question_returns_prose_block(client: Any) -> None:
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "question": "What should I study next?",
            "weak_topics": [{"label": "Fractions", "skill_id": "fraction-operations"}],
            "daily_plan": [{"title": "Simplify fractions", "skill_id": "fraction-operations"}],
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["session_complete"] is False
    blocks = data["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "prose"
    # Prose carries a spoken form for the voice transport to read aloud.
    assert blocks[0]["speak"] == blocks[0]["text"]
    assert blocks[0]["text"]


def test_practice_intent_returns_mcq_block(client: Any) -> None:
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "child_id": "student-001",
            "intent": "practice",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    blocks = data["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "mcq-tap"
    assert blocks[0]["options"]
    # The card speaks its stem so voice mode can read the question.
    assert blocks[0]["speak"]


def test_practice_walk_continues_on_answer(client: Any) -> None:
    # Opening practice card.
    first = _turn(
        client,
        {
            "user_id": "s1",
            "child_id": "s1",
            "intent": "practice",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        },
    ).get_json()
    card = first["blocks"][0]

    # Submitting an answer (without re-stating intent) must still route to the
    # card brain because the practice signal is present.
    second = _turn(
        client,
        {
            "user_id": "s1",
            "child_id": "s1",
            "last_card_id": card["card_id"],
            "last_kind": "mcq-tap",
            "answer_option_id": "z-wrong",
            "exam": "WAEC",
            "class_year": "SSS2",
            "subject": "Mathematics",
        },
    ).get_json()
    kinds = {b["kind"] for b in second["blocks"]}
    # A wrong answer yields an explanation card; a right one yields the next
    # question or a progress card — all gen-UI, never prose.
    assert kinds & {"explanation", "mcq-tap", "progress"}


def test_empty_turn_opens_with_profile_and_plan(client: Any) -> None:
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "weak_topics": [{"label": "Ratios", "skill_id": "ratio-proportion"}],
            "daily_plan": [{"title": "Scale a ratio", "skill_id": "ratio-proportion"}],
            "learner_setup": {"subject": "Mathematics", "year_group": "SSS2"},
        },
    )
    assert resp.status_code == 200
    kinds = [b["kind"] for b in resp.get_json()["blocks"]]
    assert "profile" in kinds
    assert "plan" in kinds


def test_empty_turn_with_no_signals_prompts(client: Any) -> None:
    resp = _turn(client, {"user_id": "student-001"})
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "prose"
    assert blocks[0]["smalltalk"] is True


def test_greeting_turn_returns_smalltalk_prose_not_profile_template(client: Any) -> None:
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "question": "hi",
            "weak_topics": [{"label": "Ratio and proportion", "skill_id": "ratio-proportion"}],
            "daily_plan": [{"title": "Ratio mini diagnostic"}],
            "learner_setup": {"subject": "Mathematics"},
        },
    )
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "prose"
    assert blocks[0]["smalltalk"] is True
    assert "Hi! I'm Wulo" in blocks[0]["text"]
    assert "Start with Ratio and proportion" not in blocks[0]["text"]


def test_typed_practice_request_returns_mcq_card_not_prose(client: Any) -> None:
    # The always-on composer sends only a free-form question (no intent). A
    # natural-language practice request must be routed to an exercise card,
    # seeded from the learner's setup, instead of answering in prose.
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "child_id": "student-001",
            "question": "do today's path exercises",
            "learner_setup": {"subject": "maths", "year_group": "SS2"},
            "daily_plan": [{"title": "Scale a ratio", "skill_id": "ratio-proportion"}],
        },
    )
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "mcq-tap"
    assert blocks[0]["options"]
    assert blocks[0]["speak"]


def test_typed_practice_subject_overrides_profile_subject(client: Any) -> None:
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "child_id": "student-001",
            "question": "give me agric questions to practice",
            "learner_setup": {"subject": "mathematics", "year_group": "SS2"},
        },
    )
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["kind"] == "mcq-tap"
    assert blocks[0]["skill_id"].startswith("ss3.agricultural_science.")
    assert blocks[0]["skill_id"] != "differentiation"


def test_assistant_practice_answer_updates_mastery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PATHFINDER_ASSISTANT_LLM_ENABLED", "false")
    reload_config()
    api = LearningApi()
    try:
        first = api.run_assistant_turn(
            {
                "user_id": "student-001",
                "child_id": "student-001",
                "intent": "practice",
                "exam": "WAEC",
                "class_year": "SSS3",
                "subject": "physics",
                "skill_id": "ss3.physics.measurements.phys_def",
                "skill_strict": True,
                "max_questions": 1,
            }
        )
        card = first["blocks"][0]
        assert card["kind"] == "mcq-tap"

        second = api.run_assistant_turn(
            {
                "user_id": "student-001",
                "child_id": "student-001",
                "exam": "WAEC",
                "class_year": "SSS3",
                "subject": "physics",
                "skill_id": "ss3.physics.measurements.phys_def",
                "skill_strict": True,
                "max_questions": 1,
                "last_card_id": card["card_id"],
                "last_kind": "mcq-tap",
                "answer_option_id": "a",
            }
        )
        assert second["blocks"][0]["kind"] == "progress"
        assert second.get("mastery_estimate", {}).get("probability") > 0.5
        mastery_events = getattr(api.repository, "mastery_events", [])
        assert mastery_events[-1]["skill_id"] == "ss3.physics.measurements.phys_def"
        assert mastery_events[-1]["student_id"] == "student-001"
        assert "scored_answer" not in second
    finally:
        reload_config()


def test_typed_question_still_returns_prose(client: Any) -> None:
    # A genuine concept question must NOT be hijacked into a quiz.
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "question": "What is photosynthesis?",
            "learner_setup": {"subject": "Basic Science", "year_group": "JSS3"},
        },
    )
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert blocks[0]["kind"] == "prose"


def test_passthrough_ask_intent_still_routes_practice(client: Any) -> None:
    # Some surfaces tag the turn with a non-actionable "ask" label; a typed
    # practice request must still resolve to an exercise card, not prose.
    resp = _turn(
        client,
        {
            "user_id": "student-001",
            "child_id": "student-001",
            "intent": "ask",
            "question": "quiz me on today's exercises",
            "learner_setup": {"subject": "maths", "year_group": "SS2"},
        },
    )
    assert resp.status_code == 200
    blocks = resp.get_json()["blocks"]
    assert blocks[0]["kind"] == "mcq-tap"


