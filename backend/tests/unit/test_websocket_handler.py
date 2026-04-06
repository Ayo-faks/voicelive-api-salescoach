"""Tests for the websocket_handler module."""

import os
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.services.websocket_handler import VoiceProxyHandler


class TestVoiceProxyHandler:
    """Test cases for VoiceProxyHandler."""

    def setup_method(self):
        """Disable local dev auth by default for websocket tests."""
        os.environ["LOCAL_DEV_AUTH"] = "false"

    def teardown_method(self):
        """Reset local dev auth override after websocket tests."""
        os.environ.pop("LOCAL_DEV_AUTH", None)

    def test_voice_proxy_handler_initialization(self):
        """Test handler initialization."""
        agent_manager = Mock()

        handler = VoiceProxyHandler(agent_manager)

        assert handler.agent_manager == agent_manager

    def test_has_authenticated_principal_with_principal_id(self):
        """Test websocket auth fallback accepts upgraded requests with a principal id."""
        handler = VoiceProxyHandler(Mock())
        mock_ws = Mock(environ={"HTTP_X_MS_CLIENT_PRINCIPAL_ID": "user-123"})

        assert handler._has_authenticated_principal(mock_ws) is True

    def test_has_authenticated_principal_without_principal_id(self):
        """Test websocket auth fallback rejects upgraded requests without a principal id."""
        handler = VoiceProxyHandler(Mock())
        mock_ws = Mock(environ={})

        assert handler._has_authenticated_principal(mock_ws) is False

    @pytest.mark.asyncio
    async def test_handle_connection_rejects_missing_principal(self):
        """Test handle_connection fails closed when Easy Auth headers are missing."""
        handler = VoiceProxyHandler(Mock())
        handler._send_error = AsyncMock()
        mock_ws = Mock(environ={})

        mock_loop = Mock()
        mock_loop.run_in_executor = AsyncMock(return_value=None)

        with patch("asyncio.get_event_loop", return_value=mock_loop):
            await handler.handle_connection(mock_ws)

        handler._send_error.assert_awaited_once_with(mock_ws, "Authentication required")
        mock_loop.run_in_executor.assert_awaited_once()
        assert mock_loop.run_in_executor.await_args.args[1] == mock_ws.close

    @patch("src.services.websocket_handler.config")
    def test_build_endpoint(self, mock_config):
        """Test building the Azure endpoint URL."""
        mock_config.__getitem__.side_effect = lambda key: {
            "azure_ai_resource_name": "test-resource",
        }.get(key, "default")

        handler = VoiceProxyHandler(Mock())
        endpoint = handler._build_endpoint()

        assert endpoint == "https://test-resource.cognitiveservices.azure.com"

    @patch("src.services.websocket_handler.config")
    def test_get_model_with_azure_agent(self, mock_config):
        """Test getting model name with Azure agent configuration."""
        handler = VoiceProxyHandler(Mock())
        agent_config = {"is_azure_agent": True, "model": "gpt-4o"}

        model = handler._get_model(agent_config)

        assert model is None

    @patch("src.services.websocket_handler.config")
    def test_get_model_with_local_agent(self, mock_config):
        """Test getting model name with local agent configuration."""
        mock_config.__getitem__.side_effect = lambda key: {
            "model_deployment_name": "gpt-4o",
        }.get(key, "default")

        handler = VoiceProxyHandler(Mock())
        agent_config = {"is_azure_agent": False, "model": "gpt-4"}

        model = handler._get_model(agent_config)

        assert model == "gpt-4"

    @patch("src.services.websocket_handler.config")
    def test_get_model_without_agent_config_with_global_agent_id(self, mock_config):
        """Test getting model name without agent config but with global agent_id."""
        mock_config.__getitem__.side_effect = lambda key: {
            "agent_id": "static-agent-123",
        }.get(key, "")

        handler = VoiceProxyHandler(Mock())
        model = handler._get_model(None)

        assert model is None

    @patch("src.services.websocket_handler.config")
    def test_get_model_without_agent_config(self, mock_config):
        """Test getting model name without agent config."""
        mock_config.__getitem__.side_effect = lambda key: {
            "agent_id": "",
            "model_deployment_name": "gpt-4o",
        }.get(key, "")

        handler = VoiceProxyHandler(Mock())
        model = handler._get_model(None)

        assert model == "gpt-4o"

    @patch("src.services.websocket_handler.config")
    def test_build_query_params_with_azure_agent(self, mock_config):
        """Test building query params with Azure agent configuration."""
        mock_config.__getitem__.side_effect = lambda key: {
            "azure_ai_project_name": "test-project",
        }.get(key, "")

        handler = VoiceProxyHandler(Mock())
        agent_config = {"is_azure_agent": True}

        params = handler._build_query_params("agent-123", agent_config)

        assert params["agent-id"] == "agent-123"
        assert params["agent-project-name"] == "test-project"

    @patch("src.services.websocket_handler.config")
    def test_build_query_params_with_local_agent(self, mock_config):
        """Test building query params with local agent configuration."""
        handler = VoiceProxyHandler(Mock())
        agent_config = {"is_azure_agent": False}

        params = handler._build_query_params("local-agent-123", agent_config)

        assert params == {}

    @patch("src.services.websocket_handler.config")
    def test_build_query_params_without_agent_config_with_global_agent_id(self, mock_config):
        """Test building query params without agent config but with global agent_id."""
        mock_config.__getitem__.side_effect = lambda key: {
            "agent_id": "static-agent-123",
        }.get(key, "")

        handler = VoiceProxyHandler(Mock())
        params = handler._build_query_params(None, None)

        assert params["agent-id"] == "static-agent-123"

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_without_agent(self, mock_config):
        """Test building session config without agent configuration."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        session = handler._build_session_config(None)

        assert "modalities" in session
        assert "turn_detection" in session
        assert "voice" in session

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_with_local_agent(self, mock_config):
        """Test building session config with local agent configuration."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        agent_config = {
            "is_azure_agent": False,
            "instructions": "Test instructions",
            "temperature": 0.8,
            "max_tokens": 1000,
        }

        session = handler._build_session_config(agent_config)

        assert session["instructions"] == "Test instructions"
        assert session["temperature"] == 0.8
        assert session["max_response_output_tokens"] == 1000

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_injects_runtime_personalization(self, mock_config):
        """Test approved live-session personalization is appended to session instructions."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        agent_config = {
            "is_azure_agent": False,
            "instructions": "Base instructions",
            "temperature": 0.8,
            "max_tokens": 1000,
            "runtime_personalization": {
                "active_target_sound": "r",
                "approved_targets": [{"statement": "Keep /r/ as an active therapy target."}],
                "approved_constraints": [{"statement": "Keep cues short and specific."}],
                "approved_effective_cues": [{"statement": "Short verbal models help Ayo reset quickly."}],
            },
        }

        session = handler._build_session_config(agent_config)

        assert "Base instructions" in session["instructions"]
        assert "Active target sound: /r/" in session["instructions"]
        assert "Approved constraints: Keep cues short and specific." in session["instructions"]
        assert "Approved effective cues: Short verbal models help Ayo reset quickly." in session["instructions"]

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_prefers_avatar_voice_override(self, mock_config):
        """Test avatar voice overrides the global voice selection."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        agent_config = {
            "is_azure_agent": False,
            "avatar_config": {
                "character": "meg",
                "style": "casual",
                "is_photo_avatar": False,
                "voice_name": "en-GB-AbbiNeural",
            },
        }

        session = handler._build_session_config(agent_config)

        assert session["voice"]["name"] == "en-GB-AbbiNeural"

    @pytest.mark.asyncio
    async def test_send_message(self):
        """Test sending a message to WebSocket."""
        handler = VoiceProxyHandler(Mock())

        mock_ws = Mock()

        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=None)

            message = {"type": "test", "data": "test data"}
            await handler._send_message(mock_ws, message)

            mock_loop.return_value.run_in_executor.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_error(self):
        """Test sending an error message to WebSocket."""
        handler = VoiceProxyHandler(Mock())

        mock_ws = Mock()

        with patch("asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=None)

            await handler._send_error(mock_ws, "Test error")

            mock_loop.return_value.run_in_executor.assert_called_once()

    @patch("src.services.websocket_handler.config")
    def test_get_credential_success(self, mock_config):
        """Test getting credential with valid API key."""
        mock_config.get.return_value = "test-api-key"

        handler = VoiceProxyHandler(Mock())
        credential = handler._get_credential()

        assert credential is not None
        assert credential.key == "test-api-key"

    @patch("src.services.websocket_handler.config")
    def test_get_credential_missing_key(self, mock_config):
        """Test getting credential with missing API key."""
        mock_config.get.return_value = None

        handler = VoiceProxyHandler(Mock())
        credential = handler._get_credential()

        assert credential is None
