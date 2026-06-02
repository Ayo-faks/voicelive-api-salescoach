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

from src.learning.api import LearningApi, register_learning_api


@pytest.fixture()
def client() -> Any:
    api = LearningApi()
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    return app.test_client()


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
