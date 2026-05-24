"""HTTP-route smoke tests for the skills catalogue (B5)."""

from __future__ import annotations

import pytest
from flask import Flask

from src.learning.api import LearningApi, register_learning_api


@pytest.fixture()
def client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    api = LearningApi()
    register_learning_api(app, api)
    return app.test_client()


_SKILL_BODY = {
    "skill_id": "skill-route-1",
    "tenant_id": "tenant-routes",
    "standard_id": "std-route-1",
    "name": "Adding Fractions",
    "description": "Add proper and improper fractions",
    "subject": "maths",
    "prerequisites": [],
    "kc_tags": ["fractions"],
    "localisations": {"ha": "Karawa Fraction"},
    "status": "active",
    "lang": "en-NG",
}


def test_create_skill_returns_201_like_payload(client):
    response = client.post("/api/learning/skills", json=_SKILL_BODY)
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["skill_id"] == "skill-route-1"
    assert body["status"] == "active"
    assert body["lang"] == "en-NG"
    assert body["provenance"]  # auto-populated when omitted


def test_get_skill_returns_404_for_unknown(client):
    response = client.get("/api/learning/skills/does-not-exist", query_string={"tenant_id": "tenant-routes"})
    assert response.status_code == 404


def test_get_skill_roundtrip(client):
    client.post("/api/learning/skills", json=_SKILL_BODY)
    response = client.get(
        "/api/learning/skills/skill-route-1",
        query_string={"tenant_id": "tenant-routes"},
    )
    assert response.status_code == 200
    assert response.get_json()["name"] == "Adding Fractions"


def test_list_skills_returns_paginated_envelope(client):
    for idx in range(3):
        body = dict(_SKILL_BODY)
        body["skill_id"] = f"skill-list-{idx}"
        body["standard_id"] = f"std-list-{idx}"
        body["name"] = f"Listed Skill {idx}"
        client.post("/api/learning/skills", json=body)
    response = client.get(
        "/api/learning/skills",
        query_string={"tenant_id": "tenant-routes", "limit": 2, "offset": 0},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["total"] == 3
    assert payload["limit"] == 2
    assert payload["offset"] == 0
    assert len(payload["skills"]) == 2


def test_list_skills_query_filter(client):
    for idx, name in enumerate(["Apple Pie Maths", "Banana Algebra", "Cherry Geometry"]):
        body = dict(_SKILL_BODY)
        body["skill_id"] = f"skill-filter-{idx}"
        body["standard_id"] = f"std-filter-{idx}"
        body["name"] = name
        client.post("/api/learning/skills", json=body)
    response = client.get(
        "/api/learning/skills",
        query_string={"tenant_id": "tenant-routes", "query": "banana"},
    )
    payload = response.get_json()
    assert payload["total"] == 1
    assert payload["skills"][0]["name"] == "Banana Algebra"


def test_archive_skill_route(client):
    client.post("/api/learning/skills", json=_SKILL_BODY)
    archive = client.post(
        "/api/learning/skills/skill-route-1/archive",
        json={"tenant_id": "tenant-routes"},
    )
    assert archive.status_code == 200
    assert archive.get_json()["status"] == "archived"
    # Default list filters status=active, so archived skill is gone.
    listing = client.get(
        "/api/learning/skills",
        query_string={"tenant_id": "tenant-routes"},
    ).get_json()
    assert listing["total"] == 0


def test_archive_unknown_skill_returns_404(client):
    response = client.post(
        "/api/learning/skills/never-existed/archive",
        json={"tenant_id": "tenant-routes"},
    )
    assert response.status_code == 404


def test_create_skill_rejects_self_prerequisite(client):
    body = dict(_SKILL_BODY)
    body["skill_id"] = "loop"
    body["standard_id"] = "std-loop"
    body["prerequisites"] = ["loop"]
    response = client.post("/api/learning/skills", json=body)
    assert response.status_code == 409
    assert "prerequisite" in response.get_json()["error"].lower()
