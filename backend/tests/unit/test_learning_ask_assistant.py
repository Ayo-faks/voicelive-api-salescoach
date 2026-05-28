"""HTTP coverage for the unified ``/api/learning/assistant/ask`` route.

Phase-1 deterministic provider — verifies that the assistant quotes the
learner's own profile signals (weak topics, career fits, last wrong answer)
back to them without making outcome guarantees.
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


def _post(client: Any, body: Dict[str, Any]):
    return client.post("/api/learning/assistant/ask", json=body)


def test_pathway_question_quotes_career_fits(client: Any) -> None:
    resp = _post(
        client,
        {
            "user_id": "student-001",
            "question": "Which careers fit me?",
            "career_fits": [
                {"label": "Civil engineer", "url": "https://example.test/civeng"},
                {"label": "Data analyst", "url": "https://example.test/da"},
            ],
            "weak_topics": [
                {"skill_id": "ratio-proportion", "label": "Ratio and proportion"},
            ],
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert "Civil engineer" in body["answer"]
    assert "Data analyst" in body["answer"]
    assert "no outcome guarantee" in body["answer"].lower()
    assert any(c.get("label") == "Civil engineer" for c in body["citations"])


def test_weak_topic_question_quotes_focus_topic(client: Any) -> None:
    resp = _post(
        client,
        {
            "user_id": "student-001",
            "question": "What should I study today?",
            "weak_topics": [
                {"skill_id": "ratio-proportion", "label": "Ratio and proportion"},
                {"skill_id": "fraction-operations", "label": "Fraction operations"},
            ],
            "daily_plan": [
                {"title": "Ratio mini check-in"},
                {"title": "Fraction bar practice"},
            ],
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert "Ratio and proportion" in body["answer"]
    assert "Ratio mini check-in" in body["answer"]
    assert "no outcome guarantee" in body["answer"].lower()
    labels = [c.get("label") for c in body["citations"]]
    assert "Ratio and proportion" in labels


def test_wrong_answer_question_anchors_on_last_topic(client: Any) -> None:
    resp = _post(
        client,
        {
            "user_id": "student-001",
            "question": "Why was my last answer wrong?",
            "last_wrong_answer": {
                "skill_id": "ratio-proportion",
                "label": "Ratio and proportion",
            },
            "weak_topics": [
                {"skill_id": "ratio-proportion", "label": "Ratio and proportion"},
            ],
        },
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert "Ratio and proportion" in body["answer"]
    assert "worked example" in body["answer"].lower()
    assert any(c.get("topic_id") == "ratio-proportion" for c in body["citations"])


def test_missing_question_returns_400(client: Any) -> None:
    resp = _post(client, {"user_id": "student-001"})
    assert resp.status_code == 400
