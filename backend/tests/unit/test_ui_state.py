"""Tests for /api/me/ui-state and /api/children/<id>/ui-state (Phase 1 of
onboarding-plan-v2).

Two layers:

1. Storage-layer behaviour against the real SQLite backend (conftest pins
   ``DATABASE_BACKEND=sqlite``). This validates merge semantics, audit rows,
   and the size cap without mocking.
2. HTTP-layer behaviour against the Flask test client with
   ``src.app.storage_service`` patched.

The Postgres parity run is a separate DSN-gated integration suite (repo
memory #31); the ``test_storage_factory`` suite already exercises the
create-path for that backend.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.app import app
from src.schemas.ui_state import (
    MAX_UI_STATE_BYTES,
    validate_child_ui_state_put,
    validate_merged_size,
    validate_ui_state_patch,
)
from src.services.storage import StorageService


# ---------------------------------------------------------------------------
# Schema validator unit tests
# ---------------------------------------------------------------------------


class TestUiStateSchema:
    def test_empty_patch_is_valid(self):
        normalized, errors = validate_ui_state_patch({})
        assert errors == []
        assert normalized == {}

    def test_unknown_key_rejected(self):
        _, errors = validate_ui_state_patch({"secret_token": "abc"})
        assert errors and "unknown field" in errors[0]

    def test_non_object_body_rejected(self):
        _, errors = validate_ui_state_patch(["nope"])
        assert errors == ["request body must be a JSON object"]

    def test_tours_seen_dedupes_and_preserves_order(self):
        normalized, errors = validate_ui_state_patch(
            {"tours_seen": ["welcome-therapist", "first-session", "welcome-therapist"]}
        )
        assert errors == []
        assert normalized["tours_seen"] == ["welcome-therapist", "first-session"]

    def test_tours_seen_length_cap(self):
        payload = {"tours_seen": [f"tour-{i}" for i in range(65)]}
        _, errors = validate_ui_state_patch(payload)
        assert errors and "exceeds max length" in errors[0]

    def test_tours_seen_rejects_non_string(self):
        _, errors = validate_ui_state_patch({"tours_seen": [123]})
        assert errors

    def test_help_mode_enum(self):
        _, errors = validate_ui_state_patch({"help_mode": "auto"})
        assert errors == []
        _, errors = validate_ui_state_patch({"help_mode": "SHOUTY"})
        assert errors

    def test_checklist_state_typed(self):
        normalized, errors = validate_ui_state_patch(
            {"checklist_state": {"first-login": True, "first-child": False}}
        )
        assert errors == []
        assert normalized["checklist_state"] == {"first-login": True, "first-child": False}

        _, errors = validate_ui_state_patch({"checklist_state": {"k": "yes"}})
        assert errors

    def test_onboarding_complete_must_be_bool(self):
        _, errors = validate_ui_state_patch({"onboarding_complete": "true"})
        assert errors
        normalized, errors = validate_ui_state_patch({"onboarding_complete": True})
        assert errors == []
        assert normalized == {"onboarding_complete": True}

    def test_merged_size_cap(self):
        oversize_tours = [f"t{i:04d}" for i in range(64)]
        merged = {
            "tours_seen": oversize_tours,
            # force payload above cap via a fake long array; we bypass the patch validator here
            # by constructing a synthetic merged blob directly.
            "announcements_dismissed": ["x" * 120] * 64,
        }
        errors = validate_merged_size(merged)
        # 64*120 bytes + overhead ≈ 8KB, may or may not exceed; make it definitive:
        big = {"tours_seen": ["x" * 128] * 64, "announcements_dismissed": ["y" * 128] * 64}
        errors = validate_merged_size(big)
        assert errors and "exceeds" in errors[0]

    def test_child_ui_state_put_validator(self):
        normalized, errors = validate_child_ui_state_put(
            {"exercise_type": "silent_sorting", "first_run": True}
        )
        assert errors == []
        assert normalized == {"exercise_type": "silent_sorting", "first_run": True}

        _, errors = validate_child_ui_state_put({"exercise_type": "", "first_run": True})
        assert errors

        _, errors = validate_child_ui_state_put({"exercise_type": "silent_sorting"})
        assert errors


# ---------------------------------------------------------------------------
# Storage-layer tests against real SQLite
# ---------------------------------------------------------------------------


def _fresh_storage(tmp_path: Path) -> StorageService:
    return StorageService(db_path=str(tmp_path / f"ui-state-{uuid4().hex[:6]}.db"))


def _seed_user(storage: StorageService, user_id: str = "user-1", role: str = "therapist") -> Dict[str, Any]:
    user = storage.get_or_create_user(user_id, email=f"{user_id}@example.com", name="Test", provider="aad")
    # Lift role to therapist if bootstrapping defaults to parent.
    if user.get("role") != role:
        storage.update_user_role(user_id, role)
        user = storage.get_user(user_id) or user
    return user


class TestUiStateStorage:
    def test_get_default_is_empty_dict(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        assert storage.get_user_ui_state("user-1") == {}

    def test_patch_merges_shallow(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        first = storage.patch_user_ui_state("user-1", {"tours_seen": ["welcome-therapist"]})
        assert first["tours_seen"] == ["welcome-therapist"]

        second = storage.patch_user_ui_state("user-1", {"onboarding_complete": True})
        assert second == {"tours_seen": ["welcome-therapist"], "onboarding_complete": True}

        # overwrite existing key
        third = storage.patch_user_ui_state("user-1", {"tours_seen": ["welcome-therapist", "first-session"]})
        assert third["tours_seen"] == ["welcome-therapist", "first-session"]
        assert third["onboarding_complete"] is True

    def test_patch_unknown_user_raises(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        with pytest.raises(ValueError, match="user_not_found"):
            storage.patch_user_ui_state("ghost", {"tours_seen": []})

    def test_patch_enforces_size_cap(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        # Seed the blob close to the cap then attempt an over-the-top merge.
        storage.patch_user_ui_state(
            "user-1", {"tours_seen": [f"tour-{i:04d}" for i in range(60)]}
        )
        with pytest.raises(ValueError, match="ui_state_too_large"):
            storage.patch_user_ui_state(
                "user-1",
                {"announcements_dismissed": ["x" * 128] * 64},
            )

    def test_reset_clears_blob(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        storage.patch_user_ui_state("user-1", {"onboarding_complete": True})
        assert storage.reset_user_ui_state("user-1") == {}
        assert storage.get_user_ui_state("user-1") == {}

    def test_audit_row_records_keys_only(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        storage.log_ui_state_audit(
            user_id="user-1", event="ui_state.patched", payload={"keys": ["tours_seen"]}
        )
        rows = storage.list_ui_state_audit("user-1")
        assert len(rows) == 1
        assert rows[0]["event"] == "ui_state.patched"
        assert rows[0]["payload"] == {"keys": ["tours_seen"]}

    def test_child_ui_state_set_and_clear(self, tmp_path):
        storage = _fresh_storage(tmp_path)
        _seed_user(storage)
        # Create a child and link it to the user so child_ui_state FK holds.
        child = storage.create_child(
            name="Ada", created_by_user_id="user-1", relationship="therapist"
        )
        child_id = child["id"]

        set_result = storage.put_child_ui_state_first_run(
            child_id=child_id, user_id="user-1", exercise_type="silent_sorting", first_run=True
        )
        assert set_result["exercise_type"] == "silent_sorting"
        assert set_result["first_run_at"] is not None

        clear_result = storage.put_child_ui_state_first_run(
            child_id=child_id, user_id="user-1", exercise_type="silent_sorting", first_run=False
        )
        assert clear_result["first_run_at"] is None

        state = storage.get_child_ui_state(child_id, "user-1")
        assert state["child_id"] == child_id
        assert len(state["exercises"]) == 1


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


class TestUiStateEndpoints:
    @staticmethod
    def _auth_headers() -> dict[str, str]:
        return {
            "X-MS-CLIENT-PRINCIPAL-ID": "user-123",
            "X-MS-CLIENT-PRINCIPAL-NAME": "Test User",
            "X-MS-CLIENT-PRINCIPAL-EMAIL": "user@example.com",
            "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
        }

    @staticmethod
    def _user_payload(role: str = "therapist") -> dict[str, str]:
        return {
            "id": "user-123",
            "name": "Test User",
            "email": "user@example.com",
            "provider": "aad",
            "role": role,
        }

    def setup_method(self):
        os.environ["LOCAL_DEV_AUTH"] = "false"
        app.config["TESTING"] = True
        self.client: FlaskClient = app.test_client()

    def teardown_method(self):
        os.environ.pop("LOCAL_DEV_AUTH", None)
        app_module._RATE_LIMIT_STATE.clear()

    def test_get_requires_auth(self):
        response = self.client.get("/api/me/ui-state")
        assert response.status_code == 401

    @patch("src.app.storage_service")
    def test_get_returns_blob(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.get_user_ui_state.return_value = {"onboarding_complete": True}

        response = self.client.get("/api/me/ui-state", headers=self._auth_headers())

        assert response.status_code == 200
        assert json.loads(response.data) == {"ui_state": {"onboarding_complete": True}}
        mock_storage.get_user_ui_state.assert_called_once_with("user-123")

    @patch("src.app.storage_service")
    def test_patch_happy_path(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.patch_user_ui_state.return_value = {"tours_seen": ["welcome-therapist"]}

        response = self.client.patch(
            "/api/me/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"tours_seen": ["welcome-therapist"]},
        )

        assert response.status_code == 200, response.data
        assert json.loads(response.data) == {"ui_state": {"tours_seen": ["welcome-therapist"]}}
        mock_storage.patch_user_ui_state.assert_called_once()
        # audit row with keys-only payload
        audit_call = mock_storage.log_ui_state_audit.call_args
        assert audit_call.kwargs["payload"] == {"keys": ["tours_seen"]}

    @patch("src.app.storage_service")
    def test_patch_rejects_unknown_keys(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()

        response = self.client.patch(
            "/api/me/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"tours_seen": ["ok"], "secret_api_key": "leak"},
        )

        assert response.status_code == 422
        data = json.loads(response.data)
        assert data["error"] == "invalid_ui_state_patch"
        assert any("unknown field" in message for message in data["details"])
        mock_storage.patch_user_ui_state.assert_not_called()

    @patch("src.app.storage_service")
    def test_patch_oversize_returns_413(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.patch_user_ui_state.side_effect = ValueError("ui_state_too_large")

        response = self.client.patch(
            "/api/me/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"tours_seen": ["welcome-therapist"]},
        )

        assert response.status_code == 413
        assert json.loads(response.data)["error"] == "ui_state_too_large"

    @patch("src.app.storage_service")
    def test_patch_is_rate_limited_by_ui_state_policy(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.patch_user_ui_state.return_value = {"tours_seen": ["welcome-therapist"]}

        original_get = app_module.config.get

        def config_get(key, default=None):
            if key == "rate_limit_ui_state_limit":
                return 2
            if key == "rate_limit_mutation_limit":
                return 999
            return original_get(key, default)

        with patch.object(app_module.config, "get", side_effect=config_get):
            first = self.client.patch(
                "/api/me/ui-state",
                headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
                json={"tours_seen": ["welcome-therapist"]},
            )
            second = self.client.patch(
                "/api/me/ui-state",
                headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
                json={"tours_seen": ["welcome-therapist"]},
            )
            third = self.client.patch(
                "/api/me/ui-state",
                headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
                json={"tours_seen": ["welcome-therapist"]},
            )

        assert first.status_code == 200
        assert second.status_code == 200
        assert third.status_code == 429
        assert json.loads(third.data)["error"] == "Rate limit exceeded"

    @patch("src.app.storage_service")
    def test_delete_resets_blob(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.reset_user_ui_state.return_value = {}

        response = self.client.delete(
            "/api/me/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
        )

        assert response.status_code == 200
        assert json.loads(response.data) == {"ui_state": {}}
        mock_storage.reset_user_ui_state.assert_called_once_with("user-123")

    @patch("src.app.storage_service")
    def test_child_ui_state_requires_child_access(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.user_has_child_access.return_value = False

        response = self.client.get(
            "/api/children/child-abc/ui-state",
            headers=self._auth_headers(),
        )

        assert response.status_code == 403

    @patch("src.app.storage_service")
    def test_child_ui_state_get_happy_path(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.user_has_child_access.return_value = True
        mock_storage.get_child_ui_state.return_value = {
            "child_id": "child-abc",
            "user_id": "user-123",
            "exercises": [{"exercise_type": "silent_sorting", "first_run_at": "now", "updated_at": "now"}],
        }

        response = self.client.get(
            "/api/children/child-abc/ui-state",
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        assert json.loads(response.data)["child_id"] == "child-abc"

    @patch("src.app.storage_service")
    def test_child_ui_state_put_validates(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.user_has_child_access.return_value = True

        response = self.client.put(
            "/api/children/child-abc/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"exercise_type": "", "first_run": True},
        )

        assert response.status_code == 422
        mock_storage.put_child_ui_state_first_run.assert_not_called()

    @patch("src.app.storage_service")
    def test_child_ui_state_put_happy_path(self, mock_storage):
        mock_storage.get_or_create_user.return_value = self._user_payload()
        mock_storage.user_has_child_access.return_value = True
        mock_storage.put_child_ui_state_first_run.return_value = {
            "child_id": "child-abc",
            "user_id": "user-123",
            "exercise_type": "silent_sorting",
            "first_run_at": "2026-04-23T00:00:00+00:00",
            "updated_at": "2026-04-23T00:00:00+00:00",
        }

        response = self.client.put(
            "/api/children/child-abc/ui-state",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"exercise_type": "silent_sorting", "first_run": True},
        )

        assert response.status_code == 200
        assert json.loads(response.data)["exercise_type"] == "silent_sorting"
        mock_storage.put_child_ui_state_first_run.assert_called_once()
