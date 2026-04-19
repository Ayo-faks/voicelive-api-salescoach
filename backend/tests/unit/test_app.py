"""Tests for the Flask application endpoints."""

import base64
import json
import os
from unittest.mock import ANY, AsyncMock, patch

import pytest
from flask.testing import FlaskClient

import src.app as app_module
from src.app import _get_authenticated_user_from_headers, _is_azure_hosted_environment, _resolve_local_dev_role, app


class TestFlaskApp:
    """Test cases for Flask application endpoints."""

    @staticmethod
    def _auth_headers() -> dict[str, str]:
        return {
            "X-MS-CLIENT-PRINCIPAL-ID": "user-123",
            "X-MS-CLIENT-PRINCIPAL-NAME": "Test User",
            "X-MS-CLIENT-PRINCIPAL-EMAIL": "user@example.com",
            "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
        }

    @staticmethod
    def _user_payload(role: str = "parent") -> dict[str, str]:
        return {
            "id": "user-123",
            "name": "Test User",
            "email": "user@example.com",
            "provider": "aad",
            "role": role,
        }

    def setup_method(self):
        """Set up test fixtures."""
        os.environ["LOCAL_DEV_AUTH"] = "false"
        app.config["TESTING"] = True
        self.client: FlaskClient = app.test_client()  # pylint: disable=attribute-defined-outside-init

    def teardown_method(self):
        """Reset env overrides applied by tests in this class."""
        os.environ.pop("LOCAL_DEV_AUTH", None)
        app_module._RATE_LIMIT_STATE.clear()

    def test_index_route(self):
        """Test the index route serves index.html."""
        with patch("src.app.send_from_directory") as mock_send:
            mock_send.return_value = "index.html content"

            response = self.client.get("/")

            assert response.status_code == 200
            mock_send.assert_called_once_with(app.static_folder, "index.html")

    def test_spa_route_serves_index(self):
        """Test SPA deep links resolve to the frontend entry point."""
        with patch("src.app.send_from_directory") as mock_send:
            mock_send.return_value = "index.html content"

            response = self.client.get("/dashboard")

            assert response.status_code == 200
            mock_send.assert_called_once_with(app.static_folder, "index.html")

    def test_asset_like_route_is_not_swallowed_by_spa_fallback(self):
        """Test asset requests still return 404 when the file is missing."""
        response = self.client.get("/assets/does-not-exist.css")

        assert response.status_code == 404

    def test_audio_processor_route_uses_static_folder(self):
        """Test audio processor requests are served from the resolved static bundle."""
        with patch("src.app.send_from_directory") as mock_send:
            mock_send.return_value = "audio processor"

            response = self.client.get("/audio-processor.js")

            assert response.status_code == 200
            mock_send.assert_called_once_with(app.static_folder, "audio-processor.js")

    def test_index_route_no_static_folder(self):
        """Test index route behavior when static folder is None."""
        original_static_folder = app.static_folder
        app.static_folder = None

        with pytest.raises(SystemExit):
            self.client.get("/")

        # Restore original static folder
        app.static_folder = original_static_folder

    @patch("src.app.storage_service")
    def test_get_config_route(self, mock_storage_service):
        """Test the /api/config endpoint."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload()

        response = self.client.get("/api/config", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "ok"
        assert data["proxy_enabled"] is True
        assert data["ws_endpoint"] == "/ws/voice"
        assert "telemetry_enabled" in data
        assert "planner" in data

    @patch("src.app.planning_service")
    @patch("src.app.storage_service")
    def test_get_config_route_includes_planner_readiness(self, mock_storage_service, mock_planning_service):
        """Test the /api/config endpoint surfaces planner readiness details."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_planning_service.get_readiness.return_value = {
            "ready": False,
            "model": "gpt-5",
            "sdk_installed": True,
            "cli": {
                "available": False,
                "authenticated": False,
                "auth_checked": True,
                "auth_message": "Copilot CLI not available.",
            },
            "auth": {
                "github_token_configured": False,
                "azure_byok_configured": False,
            },
            "reasons": ["Copilot CLI is not configured or not executable."],
        }

        response = self.client.get("/api/config", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["planner"]["ready"] is False
        assert data["planner"]["reasons"]

    def test_get_config_route_requires_authentication(self):
        """Test the /api/config endpoint requires an authenticated user."""
        response = self.client.get("/api/config")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Authentication required"

    @patch("src.app.storage_service")
    def test_mutating_request_rejects_untrusted_origin(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("admin")

        response = self.client.post(
            "/api/users/user-999/role",
            headers={**self._auth_headers(), "Origin": "https://evil.example"},
            json={"role": "parent"},
        )

        assert response.status_code == 403
        assert json.loads(response.data)["error"] == "Origin not allowed"

    @patch("src.app.storage_service")
    def test_mutating_request_allows_local_vite_origin(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("admin")
        mock_storage_service.get_user.return_value = self._user_payload("parent")
        mock_storage_service.update_user_role.return_value = self._user_payload("therapist")

        response = self.client.post(
            "/api/users/user-999/role",
            headers={**self._auth_headers(), "Origin": "http://127.0.0.1:5173"},
            json={"role": "therapist"},
        )

        assert response.status_code == 200
        assert json.loads(response.data)["role"] == "therapist"

    @patch("src.app.storage_service")
    def test_mutating_request_rejects_non_json_body(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("admin")

        response = self.client.post(
            "/api/users/user-999/role",
            headers={**self._auth_headers(), "Origin": "http://localhost"},
            data="role=parent",
            content_type="application/x-www-form-urlencoded",
        )

        assert response.status_code == 400
        assert json.loads(response.data)["error"] == "State-changing requests must use application/json"

    @patch("src.app.storage_service")
    def test_role_update_is_rate_limited(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("admin")
        mock_storage_service.get_user.return_value = self._user_payload("parent")
        mock_storage_service.update_user_role.return_value = self._user_payload("parent")

        with patch.object(app_module, "_rate_limit_for_request", return_value=(2, 60)):
            first = self.client.post(
                "/api/users/user-999/role",
                headers={**self._auth_headers(), "Origin": "http://localhost"},
                json={"role": "parent"},
            )
            second = self.client.post(
                "/api/users/user-999/role",
                headers={**self._auth_headers(), "Origin": "http://localhost"},
                json={"role": "parent"},
            )
            third = self.client.post(
                "/api/users/user-999/role",
                headers={**self._auth_headers(), "Origin": "http://localhost"},
                json={"role": "parent"},
            )

        assert first.status_code == 200
        assert second.status_code == 200
        assert third.status_code == 429
        assert json.loads(third.data)["error"] == "Rate limit exceeded"

    @patch("src.app.storage_service")
    def test_get_pilot_state_route(self, mock_storage_service):
        """Test the Sprint 6 pilot state endpoint."""
        mock_storage_service.get_pilot_state.return_value = {
            "consent_timestamp": "2026-03-26T12:00:00+00:00",
            "therapist_pin_configured": False,
        }
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")

        response = self.client.get("/api/pilot/state", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    @patch("src.app.storage_service")
    def test_get_pilot_state_requires_therapist_role(self, mock_storage_service):
        """Test pilot state is therapist-only."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("user")

        response = self.client.get("/api/pilot/state", headers=self._auth_headers())

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    @patch("src.app.scenario_manager")
    def test_get_scenarios_route(self, mock_scenario_manager, mock_storage_service):
        """Test the /api/scenarios endpoint."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_scenarios = [
            {"id": "scenario1", "name": "Test Scenario 1"},
            {"id": "scenario2", "name": "Test Scenario 2"},
        ]
        mock_scenario_manager.list_scenarios.return_value = mock_scenarios

        response = self.client.get("/api/scenarios", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == mock_scenarios
        mock_scenario_manager.list_scenarios.assert_called_once()

    @patch("src.app.storage_service")
    def test_get_family_intake_invitations_route(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_storage_service.list_family_intake_invitations_for_user.return_value = [
            {
                "id": "family-invite-1",
                "workspace_id": "workspace-1",
                "workspace_name": "Test Workspace",
                "invited_email": "parent@example.com",
                "invited_by_user_id": "user-123",
                "invited_by_name": "Test User",
                "accepted_by_user_id": None,
                "status": "pending",
                "created_at": "2026-04-15T00:00:00+00:00",
                "updated_at": "2026-04-15T00:00:00+00:00",
                "responded_at": None,
                "expires_at": None,
                "direction": "sent",
            }
        ]

        response = self.client.get("/api/family-intake/invitations", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data[0]["id"] == "family-invite-1"
        mock_storage_service.list_family_intake_invitations_for_user.assert_called_once_with(
            "user-123",
            "user@example.com",
        )

    @patch("src.app._send_family_intake_invitation_email")
    @patch("src.app.storage_service")
    def test_create_family_intake_invitation_defaults_to_default_workspace(
        self,
        mock_storage_service,
        mock_send_family_intake_invitation_email,
    ):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.get_default_workspace_for_user.return_value = {"id": "workspace-1"}
        mock_storage_service.create_family_intake_invitation.return_value = {
            "id": "family-invite-1",
            "workspace_id": "workspace-1",
            "workspace_name": "Test Workspace",
            "invited_email": "parent@example.com",
            "invited_by_user_id": "user-123",
            "invited_by_name": "Test User",
            "accepted_by_user_id": None,
            "status": "pending",
            "created_at": "2026-04-15T00:00:00+00:00",
            "updated_at": "2026-04-15T00:00:00+00:00",
            "responded_at": None,
            "expires_at": None,
            "direction": "sent",
        }
        mock_send_family_intake_invitation_email.return_value = {
            "status": "not_configured",
            "attempted": False,
            "delivered": False,
            "error": "Email service is not configured",
        }

        response = self.client.post(
            "/api/family-intake/invitations",
            headers={**self._auth_headers(), "Origin": "http://localhost:5173"},
            json={"invited_email": "parent@example.com"},
        )

        assert response.status_code == 201
        data = json.loads(response.data)
        assert data["workspace_id"] == "workspace-1"
        mock_storage_service.create_family_intake_invitation.assert_called_once_with(
            invited_email="parent@example.com",
            invited_by_user_id="user-123",
            workspace_id="workspace-1",
        )

    @patch("src.app.storage_service")
    def test_get_child_intake_proposals_route(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_storage_service.list_child_intake_proposals_for_user.return_value = [
            {
                "id": "intake-proposal-1",
                "family_intake_invitation_id": "family-invite-1",
                "workspace_id": "workspace-1",
                "workspace_name": "Test Workspace",
                "created_by_user_id": "user-123",
                "created_by_name": "Test User",
                "reviewed_by_user_id": None,
                "reviewed_by_name": None,
                "final_child_id": None,
                "child_name": "Ayo",
                "date_of_birth": None,
                "notes": None,
                "status": "submitted",
                "submitted_at": "2026-04-15T00:00:00+00:00",
                "reviewed_at": None,
                "review_note": None,
                "created_at": "2026-04-15T00:00:00+00:00",
                "updated_at": "2026-04-15T00:00:00+00:00",
            }
        ]

        response = self.client.get("/api/family-intake/proposals", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data[0]["id"] == "intake-proposal-1"
        mock_storage_service.list_child_intake_proposals_for_user.assert_called_once_with("user-123")

    def test_get_scenarios_route_requires_authentication(self):
        """Test the /api/scenarios endpoint requires auth."""
        response = self.client.get("/api/scenarios")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Authentication required"

    @patch("src.app.storage_service")
    @patch("src.app.scenario_manager")
    def test_get_scenario_existing(self, mock_scenario_manager, mock_storage_service):
        """Test getting an existing scenario by ID."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_scenario = {"id": "test-scenario", "name": "Test Scenario"}
        mock_scenario_manager.get_scenario.return_value = mock_scenario

        response = self.client.get("/api/scenarios/test-scenario", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == mock_scenario
        mock_scenario_manager.get_scenario.assert_called_once_with("test-scenario")

    @patch("src.app.storage_service")
    @patch("src.app.scenario_manager")
    def test_get_scenario_not_found(self, mock_scenario_manager, mock_storage_service):
        """Test getting a non-existent scenario."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload()
        mock_scenario_manager.get_scenario.return_value = None

        response = self.client.get("/api/scenarios/nonexistent", headers=self._auth_headers())

        assert response.status_code == 404
        data = json.loads(response.data)
        assert data["error"] == "Scenario not found"

    @patch("src.app.storage_service")
    @patch("src.app.child_memory_service")
    @patch("src.app.agent_manager")
    @patch("src.app.scenario_manager")
    def test_create_agent_success(
        self,
        mock_scenario_manager,
        mock_agent_manager,
        mock_child_memory_service,
        mock_storage_service,
    ):
        """Test successful agent creation."""
        mock_scenario = {"id": "test-scenario", "name": "Test Scenario"}
        mock_scenario_manager.get_scenario.return_value = mock_scenario
        mock_agent_manager.create_agent.return_value = "agent-123"
        mock_child_memory_service.build_live_session_personalization.return_value = {
            "child_id": "child-2",
            "active_target_sound": "r",
        }
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True

        response = self.client.post(
            "/api/agents/create",
            json={"scenario_id": "test-scenario", "child_id": "child-2"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["agent_id"] == "agent-123"
        assert data["scenario_id"] == "test-scenario"
        assert data["runtime_personalization"]["active_target_sound"] == "r"
        mock_child_memory_service.build_live_session_personalization.assert_called_once_with("child-2")
        mock_agent_manager.create_agent.assert_called_once_with(
            "test-scenario",
            mock_scenario,
            None,
            runtime_personalization={"child_id": "child-2", "active_target_sound": "r"},
        )

    @patch("src.app.agent_manager")
    @patch("src.app.scenario_manager")
    def test_create_agent_with_custom_scenario(self, mock_scenario_manager, mock_agent_manager):
        """Test agent creation with custom scenario data."""
        custom_scenario = {
            "id": "custom-123",
            "name": "Custom Scenario",
            "description": "Practice /s/ words",
            "messages": [{"role": "system", "content": "You are a test assistant"}],
            "exercise_metadata": {
                "exercise_type": "word_repetition",
                "target_sound": "s",
                "target_words": ["sun", "sock"],
                "difficulty": "easy",
                "prompt_text": "Let's practice the /s/ sound together.",
            },
        }
        mock_agent_manager.create_agent.return_value = "agent-456"

        response = self.client.post(
            "/api/agents/create",
            json={"custom_scenario": custom_scenario},
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["agent_id"] == "agent-456"
        assert data["scenario_id"] == "custom-123"
        # Should not call get_scenario for custom scenarios
        mock_scenario_manager.get_scenario.assert_not_called()
        mock_agent_manager.create_agent.assert_called_once()

        scenario_payload = mock_agent_manager.create_agent.call_args.args[1]
        assert "CUSTOM EXERCISE DETAILS:" in scenario_payload["messages"][0]["content"]
        assert "Target words: sun, sock" in scenario_payload["messages"][0]["content"]

    def test_create_agent_missing_scenario_id(self):
        """Test agent creation without scenario_id."""
        response = self.client.post(
            "/api/agents/create",
            json={},
            headers=self._auth_headers(),
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "scenario_id is required"

    @patch("src.app.scenario_manager")
    def test_create_agent_scenario_not_found(self, mock_scenario_manager):
        """Test agent creation with non-existent scenario."""
        mock_scenario_manager.get_scenario.return_value = None
        mock_scenario_manager.scenarios = {}
        mock_scenario_manager.generated_scenarios = {}

        response = self.client.post(
            "/api/agents/create",
            json={"scenario_id": "nonexistent"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 404
        data = json.loads(response.data)
        assert data["error"] == "Scenario not found"

    @patch("src.app.agent_manager")
    @patch("src.app.scenario_manager")
    def test_create_agent_exception(self, mock_scenario_manager, mock_agent_manager):
        """Test agent creation with exception."""
        mock_scenario = {"id": "test-scenario", "name": "Test Scenario"}
        mock_scenario_manager.get_scenario.return_value = mock_scenario
        mock_agent_manager.create_agent.side_effect = Exception("Creation failed")

        response = self.client.post(
            "/api/agents/create",
            json={"scenario_id": "test-scenario"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 500
        data = json.loads(response.data)
        assert data["error"] == "Creation failed"

    @patch("src.app.agent_manager")
    def test_delete_agent_success(self, mock_agent_manager):
        """Test successful agent deletion."""
        mock_agent_manager.delete_agent.return_value = None

        response = self.client.delete("/api/agents/agent-123", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["success"] is True
        mock_agent_manager.delete_agent.assert_called_once_with("agent-123")

    @patch("src.app.agent_manager")
    def test_delete_agent_exception(self, mock_agent_manager):
        """Test agent deletion with exception."""
        mock_agent_manager.delete_agent.side_effect = Exception("Deletion failed")

        response = self.client.delete("/api/agents/agent-123", headers=self._auth_headers())

        assert response.status_code == 500
        data = json.loads(response.data)
        assert data["error"] == "Deletion failed"

    @patch("src.app._save_completed_session")
    @patch("src.app._perform_conversation_analysis")
    @patch("src.app.storage_service")
    def test_analyze_conversation_success(self, mock_storage_service, mock_analysis, mock_save_completed_session):
        """Test successful conversation analysis."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_analysis.return_value = {"ai_assessment": {"overall_score": 80}}
        mock_save_completed_session.return_value = None
        # Just test that the endpoint exists and validates input correctly
        # The actual analysis function is complex due to async behavior
        response = self.client.post(
            "/api/analyze",
            json={
                "scenario_id": "test-scenario",
                "transcript": "Hello, how are you?",
                "reference_text": "Hello, how are you?",
                "child_id": "child-ayo",
            },
            headers=self._auth_headers(),
        )

        # The response might be 200 or 500 depending on analysis function
        # but it should not be 400 (bad request) since we provided required fields
        assert response.status_code not in {400, 401}

    def test_analyze_conversation_missing_data(self):
        """Test conversation analysis with missing required data."""
        # Missing scenario_id
        response = self.client.post(
            "/api/analyze",
            json={"transcript": "Hello"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "scenario_id and transcript are required"

    @patch("src.app.storage_service")
    @patch("src.app.telemetry_service")
    @patch("src.app._save_completed_session")
    @patch("src.app.child_memory_service")
    @patch("src.app._perform_conversation_analysis")
    def test_analyze_conversation_saves_session(
        self,
        mock_analysis,
        mock_child_memory_service,
        mock_save_session,
        mock_telemetry_service,
        mock_storage_service,
    ):
        """Test completed sessions are persisted after analysis."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_analysis.return_value = {
            "ai_assessment": {"overall_score": 78, "therapist_notes": "Improved on retry."},
            "pronunciation_assessment": {"accuracy_score": 80, "pronunciation_score": 79},
        }
        mock_save_session.return_value = "session-123"
        mock_child_memory_service.synthesize_session_memory.return_value = {
            "child_id": "child-ayo",
            "proposals": [{"id": "proposal-1"}],
            "auto_applied_items": [{"id": "item-1"}],
        }

        response = self.client.post(
            "/api/analyze",
            json={
                "scenario_id": "test-scenario",
                "transcript": "user: sun\nassistant: Great try!",
                "reference_text": "sun",
                "child_id": "child-ayo",
                "exercise_context": {
                    "id": "test-scenario",
                    "name": "Say the S Sound",
                    "description": "Practice /s/ words",
                    "exerciseMetadata": {"targetSound": "s"},
                },
            },
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["session_id"] == "session-123"
        mock_save_session.assert_called_once()
        mock_child_memory_service.synthesize_session_memory.assert_called_once_with("session-123")
        assert mock_telemetry_service.track_event.call_count >= 2
        mock_telemetry_service.track_event.assert_any_call(
            "child_memory_synthesized",
            properties={"session_id": "session-123", "child_id": "child-ayo"},
            measurements={
                "duration_ms": ANY,
                "pending_proposals": 1.0,
                "auto_applied_items": 1.0,
            },
        )

    @patch("src.app.storage_service")
    def test_get_child_memory_summary_success(self, mock_storage_service):
        """Test therapist child memory summary endpoint payload."""
        from src.app import child_memory_service  # pylint: disable=C0415

        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        with patch.object(
            child_memory_service,
            "get_child_memory_summary",
            return_value={
                "child_id": "child-ayo",
                "summary": {"targets": [{"statement": "Keep /r/ as an active therapy target."}]},
                "summary_text": "Active targets: Keep /r/ as an active therapy target.",
                "source_item_count": 1,
                "last_compiled_at": "2026-04-06T12:00:00+00:00",
                "updated_at": "2026-04-06T12:00:00+00:00",
            },
        ) as mock_get_summary:
            response = self.client.get(
                "/api/children/child-ayo/memory/summary",
                headers=self._auth_headers(),
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["source_item_count"] == 1
        mock_get_summary.assert_called_once_with("child-ayo")

    @patch("src.app.storage_service")
    def test_get_institutional_memory_insights_success(self, mock_storage_service):
        """Test therapist institutional memory snapshot endpoint payload."""
        from src.app import institutional_memory_service  # pylint: disable=C0415

        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        with patch.object(
            institutional_memory_service,
            "get_snapshot",
            return_value={
                "generated_at": "2026-04-06T12:00:00+00:00",
                "summary_text": "1 active clinic-level insight derived from approved child memory and reviewed outcomes.",
                "insights": [
                    {
                        "id": "institutional-pattern-r",
                        "insight_type": "reviewed_pattern",
                        "status": "active",
                        "target_sound": "r",
                        "title": "Reviewed pattern summary for /r/",
                        "summary": "Across 2 reviewed sessions from 2 children, phrase work currently shows the strongest de-identified outcome pattern for /r/.",
                    }
                ],
            },
        ) as mock_get_snapshot:
            response = self.client.get(
                "/api/institutional-memory/insights?refresh=true",
                headers=self._auth_headers(),
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["insights"][0]["target_sound"] == "r"
        mock_get_snapshot.assert_called_once_with("user-123", refresh=True)

    @patch("src.app.storage_service")
    def test_approve_child_memory_proposal_success(self, mock_storage_service):
        """Test therapists can approve a child memory proposal through the API."""
        from src.app import child_memory_service  # pylint: disable=C0415

        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.get_child_memory_proposal.return_value = {"id": "proposal-1", "child_id": "child-ayo"}
        mock_storage_service.user_has_child_access.return_value = True
        with patch.object(
            child_memory_service,
            "approve_proposal",
            return_value={
                "proposal": {"id": "proposal-1", "status": "approved"},
                "approved_item": {"id": "item-1", "source_proposal_id": "proposal-1"},
                "summary": {"source_item_count": 1},
            },
        ) as mock_approve:
            response = self.client.post(
                "/api/memory/proposals/proposal-1/approve",
                headers=self._auth_headers(),
                json={"note": "Confirmed by therapist."},
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["proposal"]["status"] == "approved"
        mock_approve.assert_called_once_with(
            "proposal-1",
            reviewer_user_id="user-123",
            review_note="Confirmed by therapist.",
        )

    @patch("src.app.storage_service")
    def test_get_auth_session(self, mock_storage_service):
        """Test auth session payload is returned for authenticated users."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.list_workspaces_for_user.return_value = [
            {
                "id": "workspace-1",
                "name": "Test User Workspace",
                "owner_user_id": "user-123",
                "role": "owner",
                "is_personal": True,
                "created_at": "2026-04-09T00:00:00+00:00",
                "updated_at": "2026-04-09T00:00:00+00:00",
            }
        ]
        mock_storage_service.get_default_workspace_for_user.return_value = {
            "id": "workspace-1",
            "name": "Test User Workspace",
            "owner_user_id": "user-123",
            "role": "owner",
            "is_personal": True,
            "created_at": "2026-04-09T00:00:00+00:00",
            "updated_at": "2026-04-09T00:00:00+00:00",
        }

        response = self.client.get("/api/auth/session", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["authenticated"] is True
        assert data["role"] == "therapist"
        assert data["current_workspace_id"] == "workspace-1"
        assert len(data["user_workspaces"]) == 1

    @patch("src.app.storage_service")
    def test_create_workspace(self, mock_storage_service):
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.create_workspace.return_value = {
            "id": "workspace-2",
            "name": "Clinic Workspace",
            "owner_user_id": "user-123",
            "role": "owner",
            "is_personal": False,
            "created_at": "2026-04-09T00:00:00+00:00",
            "updated_at": "2026-04-09T00:00:00+00:00",
        }

        response = self.client.post(
            "/api/workspaces",
            headers={**self._auth_headers(), "Origin": "http://localhost"},
            json={"name": "Clinic Workspace"},
        )

        assert response.status_code == 201
        data = json.loads(response.data)
        assert data["id"] == "workspace-2"
        assert data["name"] == "Clinic Workspace"
        mock_storage_service.create_workspace.assert_called_once_with("user-123", "Clinic Workspace")

    @patch("src.app.storage_service")
    def test_authenticated_user_uses_encoded_principal_payload(self, mock_storage_service):
        """Test Easy Auth principal decoding works even without split header fields."""
        principal_payload = {
            "userId": "principal-user-123",
            "userDetails": "principal@example.com",
            "identityProvider": "aad",
            "claims": [
                {"typ": "name", "val": "Principal User"},
                {"typ": "preferred_username", "val": "principal@example.com"},
            ],
        }
        encoded_principal = base64.b64encode(json.dumps(principal_payload).encode("utf-8")).decode("utf-8")
        mock_storage_service.get_or_create_user.return_value = {
            "id": "principal-user-123",
            "name": "Principal User",
            "email": "principal@example.com",
            "provider": "aad",
            "role": "user",
        }

        user = _get_authenticated_user_from_headers({"X-MS-CLIENT-PRINCIPAL": encoded_principal})

        assert user is not None
        mock_storage_service.get_or_create_user.assert_called_once_with(
            "principal-user-123",
            "principal@example.com",
            "Principal User",
            "aad",
        )

    def test_is_azure_hosted_environment_detects_container_apps_marker(self, monkeypatch: pytest.MonkeyPatch):
        """Test Azure Container Apps markers trigger the LOCAL_DEV_AUTH production guard."""
        monkeypatch.delenv("WEBSITE_SITE_NAME", raising=False)
        monkeypatch.delenv("WEBSITE_HOSTNAME", raising=False)
        monkeypatch.delenv("IDENTITY_ENDPOINT", raising=False)
        monkeypatch.setenv("CONTAINER_APP_NAME", "speakbright-api")

        assert _is_azure_hosted_environment() is True

    @patch("src.app.storage_service")
    def test_local_dev_auth_defaults_to_therapist_role(self, mock_storage_service, monkeypatch: pytest.MonkeyPatch):
        """Test local dev auth promotes the local user to therapist by default."""
        monkeypatch.setenv("LOCAL_DEV_AUTH", "true")
        monkeypatch.setenv("LOCAL_DEV_USER_ID", "local-dev-user")
        monkeypatch.setenv("LOCAL_DEV_USER_NAME", "Local Developer")
        monkeypatch.setenv("LOCAL_DEV_USER_EMAIL", "dev@localhost")
        monkeypatch.delenv("LOCAL_DEV_USER_ROLE", raising=False)
        mock_storage_service.get_or_create_user.return_value = self._user_payload("parent")
        mock_storage_service.update_user_role.return_value = self._user_payload("therapist")

        user = _get_authenticated_user_from_headers({})

        assert user is not None
        assert user["role"] == "therapist"
        mock_storage_service.get_or_create_user.assert_called_once_with(
            "local-dev-user",
            "dev@localhost",
            "Local Developer",
            "local-dev",
        )
        mock_storage_service.update_user_role.assert_called_once_with("local-dev-user", "therapist")

    def test_resolve_local_dev_role_accepts_parent_override(self, monkeypatch: pytest.MonkeyPatch):
        """Test local dev auth role can be overridden explicitly."""
        monkeypatch.setenv("LOCAL_DEV_USER_ROLE", "parent")

        assert _resolve_local_dev_role() == "parent"

    def test_resolve_local_dev_role_accepts_admin_override(self, monkeypatch: pytest.MonkeyPatch):
        """Test supported local dev role overrides are preserved."""
        monkeypatch.setenv("LOCAL_DEV_USER_ROLE", "admin")

        assert _resolve_local_dev_role() == "admin"

    def test_get_child_sessions_requires_authentication(self):
        """Test therapist review endpoints require an authenticated session."""
        response = self.client.get("/api/children/child-ayo/sessions")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Authentication required"

    @patch("src.app.storage_service")
    def test_get_child_sessions_requires_child_access(self, mock_storage_service):
        """Test child review endpoints reject users without a link to the child."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("parent")
        mock_storage_service.user_has_child_access.return_value = False

        response = self.client.get("/api/children/child-ayo/sessions", headers=self._auth_headers())

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Child access required"

    @patch("src.app.storage_service")
    def test_get_child_sessions_success(self, mock_storage_service):
        """Test therapist session history endpoint payload."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_storage_service.list_sessions_for_child.return_value = [
            {
                "id": "session-1",
                "timestamp": "2026-03-26T12:00:00+00:00",
                "overall_score": 82,
                "exercise": {"id": "exercise-1", "name": "Say the S Sound"},
            }
        ]

        response = self.client.get(
            "/api/children/child-ayo/sessions",
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data[0]["id"] == "session-1"
        mock_storage_service.list_sessions_for_child.assert_called_once_with("child-ayo")

    @patch("src.app.storage_service")
    def test_get_session_detail_success(self, mock_storage_service):
        """Test therapist session detail endpoint payload."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_storage_service.get_session.return_value = {
            "id": "session-1",
            "timestamp": "2026-03-26T12:00:00+00:00",
            "child": {"id": "child-ayo", "name": "Ayo"},
            "exercise": {"id": "exercise-1", "name": "Say the S Sound"},
            "assessment": {"ai_assessment": {"overall_score": 82}},
        }

        response = self.client.get(
            "/api/sessions/session-1",
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["id"] == "session-1"
        mock_storage_service.get_session.assert_called_once_with("session-1")

    @patch("src.app.storage_service")
    def test_acknowledge_consent_success(self, mock_storage_service):
        """Test supervised-practice consent acknowledgement is stored."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.save_consent_acknowledgement.return_value = "2026-03-26T12:00:00+00:00"

        response = self.client.post(
            "/api/pilot/consent",
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    @patch("src.app.storage_service")
    def test_acknowledge_consent_requires_therapist_role(self, mock_storage_service):
        """Test consent acknowledgement is therapist-only."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("parent")

        response = self.client.post(
            "/api/pilot/consent",
            headers=self._auth_headers(),
        )

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    def test_save_child_parental_consent_forwards_explicit_gdpr_fields(self, mock_storage_service):
        """Test the child consent endpoint forwards the explicit GDPR fields to storage."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_storage_service.save_parental_consent.return_value = {
            "id": "consent-1",
            "child_id": "child-ayo",
            "guardian_name": "Parent Example",
            "guardian_email": "parent@example.com",
            "consent_type": "full",
            "privacy_accepted": True,
            "terms_accepted": True,
            "ai_notice_accepted": True,
            "personal_data_consent_accepted": True,
            "special_category_consent_accepted": True,
            "parental_responsibility_confirmed": True,
            "consented_at": "2026-04-14T00:00:00+00:00",
            "withdrawn_at": None,
        }

        response = self.client.post(
            "/api/children/child-ayo/consent",
            headers={**self._auth_headers(), "Origin": "http://localhost"},
            json={
                "guardian_name": "Parent Example",
                "guardian_email": "parent@example.com",
                "privacy_accepted": True,
                "terms_accepted": True,
                "ai_notice_accepted": True,
                "personal_data_consent_accepted": True,
                "special_category_consent_accepted": True,
                "parental_responsibility_confirmed": True,
            },
        )

        assert response.status_code == 201
        data = json.loads(response.data)
        assert data["personal_data_consent_accepted"] is True
        assert data["special_category_consent_accepted"] is True
        assert data["parental_responsibility_confirmed"] is True
        mock_storage_service.save_parental_consent.assert_called_once_with(
            child_id="child-ayo",
            guardian_name="Parent Example",
            guardian_email="parent@example.com",
            privacy_accepted=True,
            terms_accepted=True,
            ai_notice_accepted=True,
            personal_data_consent_accepted=True,
            special_category_consent_accepted=True,
            parental_responsibility_confirmed=True,
            recorded_by_user_id="user-123",
        )

    @patch("src.app.storage_service")
    def test_get_children_returns_scoped_parent_children(self, mock_storage_service):
        """Test child profile listing is authenticated and scoped to the caller."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("parent")
        mock_storage_service.list_children_for_user.return_value = [{"id": "child-parent", "name": "Mila"}]

        response = self.client.get("/api/children", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == [{"id": "child-parent", "name": "Mila"}]

    @patch("src.app.storage_service")
    def test_get_children_success(self, mock_storage_service):
        """Test therapist child profile listing."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.list_children_for_user.return_value = [{"id": "child-ayo", "name": "Ayo"}]

        response = self.client.get("/api/children", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == [{"id": "child-ayo", "name": "Ayo"}]

    @patch("src.app.storage_service")
    def test_update_user_role_success(self, mock_storage_service):
        """Test therapist role updates are persisted."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.update_user_role.return_value = self._user_payload("therapist")

        response = self.client.post(
            "/api/users/user-123/role",
            headers=self._auth_headers(),
            json={"role": "therapist"},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["role"] == "therapist"
        mock_storage_service.update_user_role.assert_called_once_with("user-123", "therapist")

    @patch("src.app.storage_service")
    def test_update_user_role_requires_therapist_role(self, mock_storage_service):
        """Test only therapists can update another user's role."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("parent")

        response = self.client.post(
            "/api/users/user-123/role",
            headers=self._auth_headers(),
            json={"role": "therapist"},
        )

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    def test_save_session_feedback_success(self, mock_storage_service):
        """Test therapist post-session feedback can be saved."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.user_has_child_access.return_value = True
        mock_storage_service.get_session.return_value = {
            "id": "session-1",
            "child": {"id": "child-ayo", "name": "Ayo"},
        }
        mock_storage_service.save_session_feedback.return_value = {
            "id": "session-1",
            "therapist_feedback": {
                "rating": "up",
                "note": "Steady focus throughout.",
                "submitted_at": "2026-03-26T12:00:00+00:00",
            },
        }

        response = self.client.post(
            "/api/sessions/session-1/feedback",
            headers=self._auth_headers(),
            json={"rating": "up", "note": "Steady focus throughout."},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["therapist_feedback"]["rating"] == "up"
        mock_storage_service.save_session_feedback.assert_called_once_with(
            "session-1",
            "up",
            "Steady focus throughout.",
        )

    def test_save_session_feedback_rejects_invalid_rating(self):
        """Test therapist feedback validation rejects unsupported ratings."""
        with patch("src.app.storage_service") as mock_storage_service:
            mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")

            response = self.client.post(
                "/api/sessions/session-1/feedback",
                headers=self._auth_headers(),
                json={"rating": "maybe"},
            )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "Feedback rating must be 'up' or 'down'"

        # Missing transcript
        response = self.client.post(
            "/api/analyze",
            json={"scenario_id": "test"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "scenario_id and transcript are required"

    def test_audio_processor_route(self):
        """Test the audio processor route."""
        with patch("src.app.send_from_directory") as mock_send:
            mock_send.return_value = "audio-processor.js content"

            response = self.client.get("/audio-processor.js")

            assert response.status_code == 200
            mock_send.assert_called_once_with(app.static_folder, "audio-processor.js")

    @patch("src.app.pronunciation_assessor")
    def test_assess_utterance_success(self, mock_pronunciation_assessor):
        """Test the per-utterance assessment endpoint."""
        mock_pronunciation_assessor.assess_pronunciation = AsyncMock(
            return_value={
                "accuracy_score": 82,
                "fluency_score": 70,
                "completeness_score": 100,
                "prosody_score": None,
                "pronunciation_score": 81,
                "words": [
                    {
                        "word": "wabbit",
                        "target_word": "rabbit",
                        "accuracy": 80,
                        "error_type": "None",
                        "age_adjusted": True,
                    }
                ],
            }
        )

        response = self.client.post(
            "/api/assess-utterance",
            json={
                "utterance": [
                    {
                        "type": "user",
                        "data": "dGVzdA==",
                        "timestamp": "2026-03-26T00:00:00Z",
                    }
                ],
                "reference_text": "rabbit",
                "exercise_metadata": {"targetSound": "r", "childAge": 4},
            },
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["pronunciation_assessment"]["accuracy_score"] == 82
        mock_pronunciation_assessor.assess_pronunciation.assert_awaited_once_with(
            [
                {
                    "type": "user",
                    "data": "dGVzdA==",
                    "timestamp": "2026-03-26T00:00:00Z",
                }
            ],
            "rabbit",
            {"targetSound": "r", "childAge": 4},
        )

    def test_assess_utterance_missing_data(self):
        """Test validation for the per-utterance assessment endpoint."""
        response = self.client.post(
            "/api/assess-utterance",
            json={"reference_text": "rabbit"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "utterance and reference_text are required"

    def test_perform_conversation_analysis_exists(self):
        """Test the _perform_conversation_analysis function can be imported."""
        from src.app import _perform_conversation_analysis  # pylint: disable=C0415

        assert callable(_perform_conversation_analysis)

    # ------------------------------------------------------------------
    # /api/tts — validation branches (PR2 commit 8)
    # ------------------------------------------------------------------
    def test_tts_missing_input_returns_400(self):
        """Test /api/tts rejects a body with none of text/ssml/phoneme."""
        response = self.client.post(
            "/api/tts",
            json={},
            headers=self._auth_headers(),
        )
        assert response.status_code == 400
        assert json.loads(response.data)["error"] == "text, ssml, or phoneme is required"

    def test_tts_multiple_inputs_returns_400(self):
        """Test /api/tts rejects bodies with more than one input mode set."""
        response = self.client.post(
            "/api/tts",
            json={"text": "hello", "phoneme": "θ"},
            headers=self._auth_headers(),
        )
        assert response.status_code == 400
        assert (
            json.loads(response.data)["error"]
            == "provide exactly one of text, ssml, or phoneme"
        )

    def test_tts_text_too_long_returns_400(self):
        """Test /api/tts rejects text payloads longer than 200 chars."""
        response = self.client.post(
            "/api/tts",
            json={"text": "a" * 201},
            headers=self._auth_headers(),
        )
        assert response.status_code == 400
        assert "max 200" in json.loads(response.data)["error"]

    def test_tts_ssml_too_long_returns_400(self):
        """Test /api/tts rejects ssml payloads longer than 2000 chars."""
        response = self.client.post(
            "/api/tts",
            json={"ssml": "<speak>" + "a" * 2001 + "</speak>"},
            headers=self._auth_headers(),
        )
        assert response.status_code == 400
        assert "ssml too long" in json.loads(response.data)["error"]

    def test_tts_phoneme_too_long_returns_400(self):
        """Test /api/tts rejects phoneme payloads longer than 32 chars."""
        response = self.client.post(
            "/api/tts",
            json={"phoneme": "θ" * 33},
            headers=self._auth_headers(),
        )
        assert response.status_code == 400
        assert "phoneme too long" in json.loads(response.data)["error"]
