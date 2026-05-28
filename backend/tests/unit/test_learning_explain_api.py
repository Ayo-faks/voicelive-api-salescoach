"""HTTP coverage for the W3-B `/api/learning/explain` route."""

from __future__ import annotations

from typing import Any, Dict, List

import pytest
from flask import Flask

from src.learning.api import LearningApi, register_learning_api
from src.learning.models import Provenance, WikiNode
from src.learning.rag import RagRetriever, WikiCorpus


def _prov() -> List[Provenance]:
    return [Provenance(source="test:wiki", confidence=1.0, evidence_count=1)]


def _node(node_id: str, title: str, body: str, *, subject: str = "maths") -> WikiNode:
    return WikiNode(
        lang="en",
        provenance=_prov(),
        node_id=node_id,
        version="1.0.0",
        title=title,
        subject=subject,  # type: ignore[arg-type]
        year_group="JSS3",
        topic="fractions",
        body_markdown=body,
        anchors=["sec-overview"],
        status="approved",
    )


@pytest.fixture()
def client() -> Any:
    corpus = WikiCorpus(
        [
            _node(
                "wiki.frac.simplify",
                "Simplifying fractions",
                "To simplify a fraction divide the numerator and denominator by their GCD.",
            ),
            _node(
                "wiki.frac.compare",
                "Comparing fractions",
                "To compare fractions rewrite with a common denominator and compare numerators.",
            ),
        ]
    )
    api = LearningApi(rag_retriever=RagRetriever(corpus))
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    return app.test_client()


def _post(client, body: Dict[str, Any]):
    return client.post("/api/learning/explain", json=body)


def test_explain_rejects_empty_query(client) -> None:
    response = _post(client, {"query": "  "})
    assert response.status_code == 400
    assert "query is required" in response.get_json()["error"]


def test_explain_returns_grounded_hits(client) -> None:
    response = _post(client, {"query": "how do I simplify a fraction"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["refusal"] is None
    assert body["explanation"] is None  # W4 will populate
    assert body["hits"], "expected at least one hit"
    top = body["hits"][0]
    assert top["node_id"] == "wiki.frac.simplify"
    assert top["anchor"] == "sec-overview"
    assert top["score"] >= body["similarity_threshold"]
    assert "snippet" in top and top["snippet"]
    assert top["status"] == "approved"


def test_explain_refuses_when_no_match(client) -> None:
    response = _post(client, {"query": "photosynthesis chlorophyll plants"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["hits"] == []
    refusal = body["refusal"]
    assert refusal is not None
    assert refusal["reason"] == "no_grounding"
    assert refusal["learner_message"]
    assert refusal["provenance"][0]["rule_id"] == "no_grounding"


def test_explain_rejects_bad_subject(client) -> None:
    response = _post(client, {"query": "fraction", "subject": "biology"})
    assert response.status_code == 400


def test_explain_rejects_bad_year_group(client) -> None:
    response = _post(client, {"query": "fraction", "year_group": "JSS1"})
    assert response.status_code == 400


def test_explain_subject_filter_is_applied(client) -> None:
    # All seed nodes are subject="maths"; asking for english must refuse.
    response = _post(client, {"query": "simplify fraction", "subject": "english"})
    body = response.get_json()
    assert body["hits"] == []
    assert body["refusal"]["reason"] == "no_grounding"


def test_explain_with_empty_corpus_always_refuses() -> None:
    api = LearningApi(rag_retriever=RagRetriever(WikiCorpus([])))
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, api)
    client = app.test_client()
    body = client.post(
        "/api/learning/explain", json={"query": "anything"}
    ).get_json()
    assert body["hits"] == []
    assert body["refusal"]["reason"] == "no_grounding"
