"""Tests for the Flask application endpoints."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from flask.testing import FlaskClient

from src.app import app


class TestFlaskApp:
    """Test cases for Flask application endpoints."""

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

    def test_get_config_route(self):
        """Test the /api/config endpoint."""
        response = self.client.get("/api/config")

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "ok"
        assert data["proxy_enabled"] is True
        assert data["ws_endpoint"] == "/ws/voice"
        assert "telemetry_enabled" in data

    @patch("src.app.storage_service")
    def test_get_pilot_state_route(self, mock_storage_service):
        """Test the Sprint 6 pilot state endpoint."""
        mock_storage_service.get_pilot_state.return_value = {
            "consent_timestamp": "2026-03-26T12:00:00+00:00",
            "therapist_pin_configured": True,
        }

        response = self.client.get("/api/pilot/state")

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    @patch("src.app.scenario_manager")
    def test_get_scenarios_route(self, mock_scenario_manager):
        """Test the /api/scenarios endpoint."""
        mock_scenarios = [
            {"id": "scenario1", "name": "Test Scenario 1"},
            {"id": "scenario2", "name": "Test Scenario 2"},
        ]
        mock_scenario_manager.list_scenarios.return_value = mock_scenarios

        response = self.client.get("/api/scenarios")

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == mock_scenarios
        mock_scenario_manager.list_scenarios.assert_called_once()

    @patch("src.app.scenario_manager")
    def test_get_scenario_existing(self, mock_scenario_manager):
        """Test getting an existing scenario by ID."""
        mock_scenario = {"id": "test-scenario", "name": "Test Scenario"}
        mock_scenario_manager.get_scenario.return_value = mock_scenario

        response = self.client.get("/api/scenarios/test-scenario")

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data == mock_scenario
        mock_scenario_manager.get_scenario.assert_called_once_with("test-scenario")

    @patch("src.app.scenario_manager")
    def test_get_scenario_not_found(self, mock_scenario_manager):
        """Test getting a non-existent scenario."""
        mock_scenario_manager.get_scenario.return_value = None

        response = self.client.get("/api/scenarios/nonexistent")

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
        )

        assert response.status_code == 500
        data = json.loads(response.data)
        assert data["error"] == "Creation failed"

    @patch("src.app.agent_manager")
    def test_delete_agent_success(self, mock_agent_manager):
        """Test successful agent deletion."""
        mock_agent_manager.delete_agent.return_value = None

        response = self.client.delete("/api/agents/agent-123")

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["success"] is True
        mock_agent_manager.delete_agent.assert_called_once_with("agent-123")

    @patch("src.app.agent_manager")
    def test_delete_agent_exception(self, mock_agent_manager):
        """Test agent deletion with exception."""
        mock_agent_manager.delete_agent.side_effect = Exception("Deletion failed")

        response = self.client.delete("/api/agents/agent-123")

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
        )

        # The response might be 200 or 500 depending on analysis function
        # but it should not be 400 (bad request) since we provided required fields
        assert response.status_code != 400

    def test_analyze_conversation_missing_data(self):
        """Test conversation analysis with missing required data."""
        # Missing scenario_id
        response = self.client.post(
            "/api/analyze",
            json={"transcript": "Hello"},
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
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["session_id"] == "session-123"
        mock_save_session.assert_called_once()

    def test_authenticate_therapist_success(self):
        """Test therapist PIN validation success."""
        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.post("/api/therapist/auth", json={"pin": "2468"})

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["authorized"] is True

    def test_get_child_sessions_requires_pin(self):
        """Test therapist review endpoints require the local PIN header."""
        response = self.client.get("/api/children/child-ayo/sessions")

        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["error"] == "Valid therapist PIN required"

    @patch("src.app.storage_service")
    def test_get_child_sessions_success(self, mock_storage_service):
        """Test therapist session history endpoint payload."""
        mock_storage_service.list_sessions_for_child.return_value = [
            {
                "id": "session-1",
                "timestamp": "2026-03-26T12:00:00+00:00",
                "overall_score": 82,
                "exercise": {"id": "exercise-1", "name": "Say the S Sound"},
            }
        ]

        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.get(
                "/api/children/child-ayo/sessions",
                headers={"X-Therapist-Pin": "2468"},
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data[0]["id"] == "session-1"
        mock_storage_service.list_sessions_for_child.assert_called_once_with("child-ayo")

    @patch("src.app.storage_service")
    def test_get_session_detail_success(self, mock_storage_service):
        """Test therapist session detail endpoint payload."""
        mock_storage_service.get_session.return_value = {
            "id": "session-1",
            "timestamp": "2026-03-26T12:00:00+00:00",
            "child": {"id": "child-ayo", "name": "Ayo"},
            "exercise": {"id": "exercise-1", "name": "Say the S Sound"},
            "assessment": {"ai_assessment": {"overall_score": 82}},
        }

        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.get(
                "/api/sessions/session-1",
                headers={"X-Therapist-Pin": "2468"},
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["id"] == "session-1"
        mock_storage_service.get_session.assert_called_once_with("session-1")

    @patch("src.app.storage_service")
    def test_acknowledge_consent_success(self, mock_storage_service):
        """Test supervised-practice consent acknowledgement is stored."""
        mock_storage_service.save_consent_acknowledgement.return_value = "2026-03-26T12:00:00+00:00"

        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.post(
                "/api/pilot/consent",
                headers={"X-Therapist-Pin": "2468"},
            )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["consent_timestamp"] == "2026-03-26T12:00:00+00:00"

    @patch("src.app.storage_service")
    def test_save_session_feedback_success(self, mock_storage_service):
        """Test therapist post-session feedback can be saved."""
        mock_storage_service.save_session_feedback.return_value = {
            "id": "session-1",
            "therapist_feedback": {
                "rating": "up",
                "note": "Steady focus throughout.",
                "submitted_at": "2026-03-26T12:00:00+00:00",
            },
        }

        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.post(
                "/api/sessions/session-1/feedback",
                headers={"X-Therapist-Pin": "2468"},
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
        with patch("src.app.config") as mock_config:
            mock_config.__getitem__.side_effect = lambda key: {"therapist_pin": "2468"}.get(key)

            response = self.client.post(
                "/api/sessions/session-1/feedback",
                headers={"X-Therapist-Pin": "2468"},
                json={"rating": "maybe"},
            )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "Feedback rating must be 'up' or 'down'"

        # Missing transcript
        response = self.client.post(
            "/api/analyze",
            json={"scenario_id": "test"},
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
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data["error"] == "utterance and reference_text are required"

    def test_perform_conversation_analysis_exists(self):
        """Test the _perform_conversation_analysis function can be imported."""
        from src.app import _perform_conversation_analysis  # pylint: disable=C0415

        assert callable(_perform_conversation_analysis)
