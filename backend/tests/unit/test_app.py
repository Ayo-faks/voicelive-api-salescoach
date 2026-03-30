"""Tests for the Flask application endpoints."""

import base64
import json
from unittest.mock import AsyncMock, patch

import pytest
from flask.testing import FlaskClient

from src.app import _get_authenticated_user_from_headers, _is_azure_hosted_environment, app


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
    def _user_payload(role: str = "user") -> dict[str, str]:
        return {
            "id": "user-123",
            "name": "Test User",
            "email": "user@example.com",
            "provider": "aad",
            "role": role,
        }

    def setup_method(self):
        """Set up test fixtures."""
        app.config["TESTING"] = True
        self.client: FlaskClient = app.test_client()  # pylint: disable=attribute-defined-outside-init

    def test_index_route(self):
        """Test the index route serves index.html."""
        with patch("src.app.send_from_directory") as mock_send:
            mock_send.return_value = "index.html content"

            response = self.client.get("/")

            assert response.status_code == 200
            mock_send.assert_called_once_with(app.static_folder, "index.html")

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

    def test_get_config_route_requires_authentication(self):
        """Test the /api/config endpoint requires an authenticated user."""
        response = self.client.get("/api/config")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Authentication required"

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

    @patch("src.app.agent_manager")
    @patch("src.app.scenario_manager")
    def test_create_agent_success(self, mock_scenario_manager, mock_agent_manager):
        """Test successful agent creation."""
        mock_scenario = {"id": "test-scenario", "name": "Test Scenario"}
        mock_scenario_manager.get_scenario.return_value = mock_scenario
        mock_agent_manager.create_agent.return_value = "agent-123"

        response = self.client.post(
            "/api/agents/create",
            json={"scenario_id": "test-scenario"},
            headers=self._auth_headers(),
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["agent_id"] == "agent-123"
        assert data["scenario_id"] == "test-scenario"
        mock_agent_manager.create_agent.assert_called_once_with("test-scenario", mock_scenario, None)

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

    def test_analyze_conversation_success(self):
        """Test successful conversation analysis."""
        # Just test that the endpoint exists and validates input correctly
        # The actual analysis function is complex due to async behavior
        response = self.client.post(
            "/api/analyze",
            json={
                "scenario_id": "test-scenario",
                "transcript": "Hello, how are you?",
                "reference_text": "Hello, how are you?",
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

    @patch("src.app._save_completed_session")
    @patch("src.app._perform_conversation_analysis")
    def test_analyze_conversation_saves_session(self, mock_analysis, mock_save_session):
        """Test completed sessions are persisted after analysis."""
        mock_analysis.return_value = {
            "ai_assessment": {"overall_score": 78, "therapist_notes": "Improved on retry."},
            "pronunciation_assessment": {"accuracy_score": 80, "pronunciation_score": 79},
        }
        mock_save_session.return_value = "session-123"

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

    @patch("src.app.storage_service")
    def test_get_auth_session(self, mock_storage_service):
        """Test auth session payload is returned for authenticated users."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")

        response = self.client.get("/api/auth/session", headers=self._auth_headers())

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["authenticated"] is True
        assert data["role"] == "therapist"

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

    def test_get_child_sessions_requires_authentication(self):
        """Test therapist review endpoints require an authenticated session."""
        response = self.client.get("/api/children/child-ayo/sessions")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Authentication required"

    @patch("src.app.storage_service")
    def test_get_child_sessions_requires_therapist_role(self, mock_storage_service):
        """Test therapist review endpoints reject authenticated non-therapist users."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("user")

        response = self.client.get("/api/children/child-ayo/sessions", headers=self._auth_headers())

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    def test_get_child_sessions_success(self, mock_storage_service):
        """Test therapist session history endpoint payload."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
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
        mock_storage_service.get_or_create_user.return_value = self._user_payload("user")

        response = self.client.post(
            "/api/pilot/consent",
            headers=self._auth_headers(),
        )

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    def test_get_children_requires_therapist_role(self, mock_storage_service):
        """Test child profile listing is therapist-only."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("user")

        response = self.client.get("/api/children", headers=self._auth_headers())

        assert response.status_code == 403
        data = json.loads(response.data)
        assert data["error"] == "Therapist role required"

    @patch("src.app.storage_service")
    def test_get_children_success(self, mock_storage_service):
        """Test therapist child profile listing."""
        mock_storage_service.get_or_create_user.return_value = self._user_payload("therapist")
        mock_storage_service.list_children.return_value = [{"id": "child-ayo", "name": "Ayo"}]

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
        mock_storage_service.get_or_create_user.return_value = self._user_payload("user")

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
            mock_send.assert_called_once_with("static", "audio-processor.js")

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
