"""A4: Kolibri LTI 1.3 login and launch flow."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from flask import Flask
from jwt.utils import base64url_encode

from src.learning.api import ITEM_BANK_PATH, LearningApi, register_learning_api
from src.learning.diagnostic import load_item_bank
from src.learning.lti import (
    CONTEXT_CLAIM,
    DEPLOYMENT_ID_CLAIM,
    MESSAGE_TYPE_CLAIM,
    RESOURCE_LINK_CLAIM,
    ROLES_CLAIM,
    VERSION_CLAIM,
    LTIPlatformConfig,
)


ISSUER = "https://kolibri.example.test"
CLIENT_ID = "pathfinder-client"
DEPLOYMENT_ID = "kolibri-deployment-1"
SESSION_SECRET = "unit-test-lti-session-secret-32b"


@pytest.fixture()
def rsa_keys() -> Dict[str, Any]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()

    def encode_int(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, byteorder="big")
        return base64url_encode(raw).decode("ascii")

    jwks = {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "kid": "test-key-1",
                "alg": "RS256",
                "n": encode_int(public_numbers.n),
                "e": encode_int(public_numbers.e),
            }
        ]
    }
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return {"private_pem": private_pem, "jwks": jwks}


@pytest.fixture()
def platform() -> LTIPlatformConfig:
    return LTIPlatformConfig(
        issuer=ISSUER,
        client_id=CLIENT_ID,
        auth_login_url="https://kolibri.example.test/lti/auth",
        auth_token_url="https://kolibri.example.test/lti/token",
        jwks_url="https://kolibri.example.test/.well-known/jwks.json",
        deployment_ids=[DEPLOYMENT_ID],
    )


@pytest.fixture()
def learning_api(platform: LTIPlatformConfig, rsa_keys: Dict[str, Any]) -> LearningApi:
    return LearningApi(
        item_bank=load_item_bank(Path(ITEM_BANK_PATH)),
        lti_platforms=[platform],
        lti_jwks_provider=lambda _platform: rsa_keys["jwks"],
        lti_session_secret=SESSION_SECRET,
    )


@pytest.fixture()
def client(learning_api: LearningApi):
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app, learning_api)
    return app.test_client()


def _login(client) -> Dict[str, str]:
    response = client.post(
        "/api/learning/lti/login",
        data={
            "iss": ISSUER,
            "login_hint": "pilot-login-hint",
            "target_link_uri": "https://pathfinder.example.test/api/learning/lti/launch",
            "lti_message_hint": "lesson-42",
            "client_id": CLIENT_ID,
            "lti_deployment_id": DEPLOYMENT_ID,
        },
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    redirect_url = response.get_json()["redirect_url"]
    parsed = urlparse(redirect_url)
    query = {key: values[0] for key, values in parse_qs(parsed.query).items()}
    return {"redirect_url": redirect_url, **query}


def _id_token(
    private_pem: bytes,
    nonce: str,
    *,
    aud: str = CLIENT_ID,
    exp_offset: int = 300,
    deployment_id: str = DEPLOYMENT_ID,
    roles: list[str] | None = None,
) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": aud,
        "sub": "kolibri-user-001",
        "nonce": nonce,
        "exp": now + exp_offset,
        "iat": now - 5,
        DEPLOYMENT_ID_CLAIM: deployment_id,
        MESSAGE_TYPE_CLAIM: "LtiResourceLinkRequest",
        VERSION_CLAIM: "1.3.0",
        RESOURCE_LINK_CLAIM: {"id": "kolibri-lesson-42", "title": "Fractions lesson"},
        ROLES_CLAIM: roles
        or ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
        CONTEXT_CLAIM: {"id": "class-kolibri-jss2", "label": "tenant-kolibri", "title": "JSS2"},
    }
    return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": "test-key-1"})


def test_lti_login_and_launch_redirects_with_signed_session(client, learning_api: LearningApi, rsa_keys: Dict[str, Any]):
    login = _login(client)
    assert login["response_type"] == "id_token"
    assert login["response_mode"] == "form_post"
    assert login["scope"] == "openid"
    assert login["client_id"] == CLIENT_ID
    assert login["prompt"] == "none"

    id_token = _id_token(rsa_keys["private_pem"], login["nonce"])
    response = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": login["state"]})

    assert response.status_code == 302, response.get_data(as_text=True)
    location = response.headers["Location"]
    assert location.startswith("/learning/launch?session=")
    session = parse_qs(urlparse(location).query)["session"][0]
    decoded = jwt.decode(session, SESSION_SECRET, algorithms=["HS256"])
    assert decoded["tenant_id"] == "tenant-kolibri"
    assert decoded["class_id"] == "class-kolibri-jss2"
    assert decoded["student_id"] == "kolibri-user-001"
    assert decoded["role"] == "teacher"

    launch_statements = [
        statement
        for statement in learning_api.repository.xapi_statements
        if statement["verb_id"] == "https://pathfinder.learn/xapi/verbs/launched-lti"
    ]
    assert len(launch_statements) == 1
    assert launch_statements[0]["sink_status"] in {"ralph_queued", "ralph_synced"}


def test_lti_launch_rejects_wrong_audience(client, rsa_keys: Dict[str, Any]):
    login = _login(client)
    id_token = _id_token(rsa_keys["private_pem"], login["nonce"], aud="wrong-client")

    response = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": login["state"]})

    assert response.status_code == 401


def test_lti_launch_rejects_expired_token(client, rsa_keys: Dict[str, Any]):
    login = _login(client)
    id_token = _id_token(rsa_keys["private_pem"], login["nonce"], exp_offset=-120)

    response = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": login["state"]})

    assert response.status_code == 401


def test_lti_launch_rejects_unknown_deployment(client, rsa_keys: Dict[str, Any]):
    login = _login(client)
    id_token = _id_token(rsa_keys["private_pem"], login["nonce"], deployment_id="unknown-deployment")

    response = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": login["state"]})

    assert response.status_code == 401


def test_lti_launch_rejects_reused_nonce(client, rsa_keys: Dict[str, Any]):
    first_login = _login(client)
    id_token = _id_token(rsa_keys["private_pem"], first_login["nonce"])
    first = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": first_login["state"]})
    assert first.status_code == 302

    second_login = _login(client)
    second = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": second_login["state"]})

    assert second.status_code == 401
    assert "reused LTI nonce" in second.get_json()["error"]


def test_lti_launch_rejects_state_mismatch(client, rsa_keys: Dict[str, Any]):
    login = _login(client)
    id_token = _id_token(rsa_keys["private_pem"], login["nonce"])

    response = client.post("/api/learning/lti/launch", data={"id_token": id_token, "state": "missing-state"})

    assert response.status_code == 401