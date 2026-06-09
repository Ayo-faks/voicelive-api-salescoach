"""Tests for the websocket_handler module."""

import os
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.services.websocket_handler import VoiceProxyHandler
from src.services.voice_agent_profiles import AgentProfileContext, get_profile


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

    def test_profile_context_includes_current_card_query_params(self):
        """Learner practice voice can bind the current card over /ws/voice."""
        handler = VoiceProxyHandler(Mock())
        mock_ws = Mock(
            environ={
                "QUERY_STRING": "scope=learner&child_id=stu-1&last_card_id=card-7&last_kind=mcq-tap"
            }
        )

        context = handler._get_profile_context(mock_ws)

        assert context.scope == "learner"
        assert context.child_id == "stu-1"
        assert context.last_card_id == "card-7"
        assert context.last_kind == "mcq-tap"

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
            "voice_live_model": "gpt-5-preview",
        }.get(key, "default")
        mock_config.get.side_effect = lambda key, default=None: {
            "voice_live_model": "gpt-5-preview",
        }.get(key, default)

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
            "voice_live_model": "gpt-5-preview",
        }.get(key, "")
        mock_config.get.side_effect = lambda key, default=None: {
            "voice_live_model": "gpt-5-preview",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        model = handler._get_model(None)

        assert model == "gpt-5-preview"

    def test_learner_tool_followup_response_instructs_model_to_speak_card(self):
        """Learner tool output is card JSON, so the follow-up tells the model how to speak it."""
        handler = VoiceProxyHandler(Mock())
        profile = get_profile("learner")

        message = handler._build_profile_tool_response_create(profile)

        assert message["type"] == "response.create"
        instructions = message["response"]["instructions"]
        assert "card.speak" in instructions
        assert "wrong format" in instructions

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
            "azure_custom_lexicon_url": "",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        session = handler._build_session_config(None)

        assert "modalities" in session
        assert "turn_detection" in session
        assert "voice" in session
        assert session["input_audio_format"] == "pcm16"
        assert session["input_audio_sampling_rate"] == 24000
        assert session["output_audio_format"] == "pcm16"

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_includes_custom_lexicon_url_when_configured(self, mock_config):
        """Test session voice config carries the custom lexicon URL when enabled."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "https://example.com/r-drill-lexicon.xml",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        session = handler._build_session_config(None)

        assert session["voice"]["custom_lexicon_url"] == "https://example.com/r-drill-lexicon.xml"

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_with_local_agent(self, mock_config):
        """Test building session config with local agent configuration."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
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

        assert session["instructions"].startswith("Test instructions")
        # Phoneme citation rule is appended to every session's instructions so
        # Voice Live never letter-names target sounds.
        assert "PHONEME CITATION RULES" in session["instructions"]
        assert session["temperature"] == 0.8
        assert session["max_response_output_tokens"] == 1000

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_injects_runtime_personalization(self, mock_config):
        """Test approved live-session personalization is appended to session instructions."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
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
            "azure_custom_lexicon_url": "",
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

    def test_learner_response_create_forces_get_next_card_tool(self):
        """Learner VoiceLive turns must start by calling the card planner tool."""
        handler = VoiceProxyHandler(Mock())
        message = {"type": "response.create"}

        handler._apply_profile_response_tool_choice(message, get_profile("learner"))

        assert message["response"]["tool_choice"] == {
            "type": "function",
            "name": "get_next_card",
        }

    def test_learner_ask_response_create_forces_ask_pathfinder_tool(self):
        """AskPathfinder VoiceLive turns must route through ask_pathfinder."""
        handler = VoiceProxyHandler(Mock())
        message = {"type": "response.create"}

        handler._apply_profile_response_tool_choice(message, get_profile("learner_ask"))

        assert message["response"]["tool_choice"] == {
            "type": "function",
            "name": "ask_pathfinder",
        }

    def test_practice_response_create_keeps_existing_tool_choice_behavior(self):
        """Practice VoiceLive sessions keep the existing auto tool behavior."""
        handler = VoiceProxyHandler(Mock())
        message = {"type": "response.create"}

        handler._apply_profile_response_tool_choice(message, get_profile("practice"))

        assert "response" not in message

    @pytest.mark.asyncio
    async def test_profile_tool_call_sends_output_without_starting_active_response(self):
        """Tool output is sent first; the follow-up response is queued after response.done."""
        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()
        azure_conn = Mock()
        azure_conn.send = AsyncMock()
        handled_call_ids: set[str] = set()
        event = {
            "type": "response.function_call_arguments.done",
            "name": "get_next_card",
            "call_id": "call-123",
            "arguments": '{"child_id":"child-1","exam":"WAEC","class_year":"SSS2","subject":"Mathematics"}',
        }

        handled = await handler._maybe_handle_profile_tool_call(
            event,
            azure_conn,
            Mock(),
            get_profile("learner"),
            AgentProfileContext(scope="learner"),
            handled_call_ids,
        )

        assert handled is True
        azure_conn.send.assert_awaited_once()
        assert azure_conn.send.await_args.args[0]["item"]["type"] == "function_call_output"
        handler._send_message.assert_awaited_once()

        handled_again = await handler._maybe_handle_profile_tool_call(
            event,
            azure_conn,
            Mock(),
            get_profile("learner"),
            AgentProfileContext(scope="learner"),
            handled_call_ids,
        )

        assert handled_again is True
        azure_conn.send.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_learner_ask_tool_call_emits_assistant_blocks(self):
        """learner_ask tool output emits one wulo.assistant_block frame per screened block."""
        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()
        azure_conn = Mock()
        azure_conn.send = AsyncMock()
        handled_call_ids: set[str] = set()
        event = {
            "type": "response.function_call_arguments.done",
            "name": "ask_pathfinder",
            "call_id": "call-ask-1",
            "arguments": '{"question":"help me"}',
        }
        client_ws = Mock()

        profile = Mock()
        profile.id = "learner_ask"
        profile.tool_handlers = {"ask_pathfinder": Mock()}
        profile.handle_tool_call.return_value = {
            "blocks": [
                {
                    "kind": "prose",
                    "speak": "Safe answer.",
                    "text": "Safe answer.",
                    "citations": [{"label": "Source"}],
                }
            ],
            "session_complete": True,
        }

        with patch.object(
            VoiceProxyHandler,
            "_screen_assistant_blocks",
            return_value=profile.handle_tool_call.return_value["blocks"],
        ) as mock_screen:
            handled = await handler._maybe_handle_profile_tool_call(
                event,
                azure_conn,
                client_ws,
                profile,
                AgentProfileContext(scope="learner_ask"),
                handled_call_ids,
            )

        assert handled is True
        azure_conn.send.assert_awaited_once()
        mock_screen.assert_called_once()
        handler._send_message.assert_awaited_once_with(
            client_ws,
            {
                "type": "wulo.assistant_block",
                "payload": {
                    "block": {
                        "kind": "prose",
                        "speak": "Safe answer.",
                        "text": "Safe answer.",
                        "citations": [{"label": "Source"}],
                    },
                    "session_complete": True,
                },
            },
        )

    @pytest.mark.asyncio
    async def test_learner_ask_tool_call_drops_all_screened_blocks(self):
        """If outbound screening drops every block, nothing is emitted to the client."""
        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()
        azure_conn = Mock()
        azure_conn.send = AsyncMock()
        handled_call_ids: set[str] = set()
        event = {
            "type": "response.function_call_arguments.done",
            "name": "ask_pathfinder",
            "call_id": "call-ask-2",
            "arguments": '{"question":"help me"}',
        }
        client_ws = Mock()

        profile = Mock()
        profile.id = "learner_ask"
        profile.tool_handlers = {"ask_pathfinder": Mock()}
        profile.handle_tool_call.return_value = {
            "blocks": [{"kind": "prose", "text": "Blocked text."}],
            "session_complete": False,
        }

        with patch.object(VoiceProxyHandler, "_screen_assistant_blocks", return_value=[]):
            handled = await handler._maybe_handle_profile_tool_call(
                event,
                azure_conn,
                client_ws,
                profile,
                AgentProfileContext(scope="learner_ask"),
                handled_call_ids,
            )

        assert handled is True
        azure_conn.send.assert_awaited_once()
        handler._send_message.assert_not_awaited()

    def test_profile_instruction_block_omits_focus_when_absent(self):
        """Without a focus item the learner instructions have no Dig-Deeper block."""
        handler = VoiceProxyHandler(Mock())
        block = handler._build_profile_instruction_block(
            get_profile("learner"),
            AgentProfileContext(scope="learner", child_id="stu-1"),
        )
        assert "DIG-DEEPER FOCUS ITEM" not in block
        assert "SESSION CONTEXT" in block

    def test_profile_instruction_block_anchors_on_focus_item(self):
        """A focus item is injected as an anchor with Socratic guidance when unscored."""
        handler = VoiceProxyHandler(Mock())
        context = AgentProfileContext(
            scope="learner",
            child_id="stu-1",
            subject="Mathematics",
            class_year="SSS2",
            focus_stem="Differentiate y = 3x^2 with respect to x.",
            focus_skill_id="differentiation",
            focus_misconception="forgetting to multiply by the exponent",
            focus_scored=False,
        )
        block = handler._build_profile_instruction_block(get_profile("learner"), context)
        assert "DIG-DEEPER FOCUS ITEM" in block
        assert "Differentiate y = 3x^2" in block
        assert "differentiation" in block
        assert "forgetting to multiply by the exponent" in block
        # Unscored -> stay Socratic, never reveal the answer.
        assert "Socratic" in block
        assert "never reveal the final answer" in block

    def test_profile_instruction_block_allows_full_explanation_when_scored(self):
        """A scored focus item permits a full worked explanation."""
        handler = VoiceProxyHandler(Mock())
        context = AgentProfileContext(
            scope="learner",
            child_id="stu-1",
            focus_stem="Differentiate y = 3x^2.",
            focus_scored=True,
        )
        block = handler._build_profile_instruction_block(get_profile("learner"), context)
        assert "already scored" in block
        assert "worked solution" in block

    def test_profile_instruction_block_injects_grounded_sources(self, monkeypatch):
        """When retrieval returns hits, they are injected as cite-able sources."""
        import src.services.websocket_handler as mod

        class _Node:
            body_markdown = "Multiply each term by its exponent, then reduce the power by one."

        class _Hit:
            node = _Node()

        class _Retriever:
            similarity_threshold = 0.5

        monkeypatch.setattr(mod, "_get_learner_focus_retriever", lambda: _Retriever())
        monkeypatch.setattr(
            "src.learning.rag.retrieve_or_refuse",
            lambda *args, **kwargs: ([_Hit()], None),
        )

        handler = VoiceProxyHandler(Mock())
        context = AgentProfileContext(
            scope="learner",
            child_id="stu-1",
            subject="Mathematics",
            class_year="SSS2",
            focus_stem="Differentiate y = 3x^2.",
            focus_scored=True,
        )
        block = handler._build_profile_instruction_block(get_profile("learner"), context)
        assert "GROUNDING SOURCES" in block
        assert "[S1] Multiply each term by its exponent" in block

    def test_profile_instruction_block_defers_when_no_sources(self, monkeypatch):
        """No retriever/hits -> instruct the model to defer rather than invent."""
        import src.services.websocket_handler as mod

        monkeypatch.setattr(mod, "_get_learner_focus_retriever", lambda: None)
        handler = VoiceProxyHandler(Mock())
        context = AgentProfileContext(
            scope="learner",
            child_id="stu-1",
            focus_stem="Differentiate y = 3x^2.",
            focus_scored=True,
        )
        block = handler._build_profile_instruction_block(get_profile("learner"), context)
        assert "No curriculum source was retrieved" in block
        assert "GROUNDING SOURCES" not in block

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_uses_legacy_vad_by_default(self, mock_config):
        """With the conversational mic flag off (default), turn_detection stays on the legacy semantic VAD."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
            "conversational_mic_enabled": False,
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        os.environ.pop("CONVERSATIONAL_MIC_ENABLED", None)

        session = handler._build_session_config(None)

        assert session["turn_detection"]["type"] == "azure_semantic_vad"
        # Legacy shape: no tunables, no barge-in flag.
        assert "threshold" not in session["turn_detection"]
        assert "interrupt_response" not in session["turn_detection"]

    @patch("src.services.websocket_handler.config")
    def test_build_session_config_conversational_mode_applies_tunables(self, mock_config):
        """With CONVERSATIONAL_MIC_ENABLED=true, turn_detection uses the English semantic VAD with barge-in."""
        mock_config.get.side_effect = lambda key, default=None: {
            "azure_voice_name": "en-US-TestVoice",
            "azure_voice_type": "azure-standard",
            "azure_custom_lexicon_url": "",
            "azure_avatar_character": "meg",
            "azure_avatar_style": "casual",
            "semantic_vad_threshold": 0.55,
            "semantic_vad_prefix_padding_ms": 320,
            "semantic_vad_silence_duration_ms": 650,
        }.get(key, default)

        handler = VoiceProxyHandler(Mock())
        os.environ["CONVERSATIONAL_MIC_ENABLED"] = "true"
        try:
            session = handler._build_session_config(None)
        finally:
            os.environ.pop("CONVERSATIONAL_MIC_ENABLED", None)

        td = session["turn_detection"]
        assert td["type"] == "azure_semantic_vad_en"
        assert td["threshold"] == 0.55
        assert td["prefix_padding_ms"] == 320
        assert td["silence_duration_ms"] == 650
        assert td["interrupt_response"] is True
        assert td["create_response"] is True

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

    @patch("src.services.azure_openai_auth.AsyncDefaultAzureCredential")
    @patch("src.services.websocket_handler.config")
    def test_get_credential_prefers_managed_identity(
        self, mock_config, mock_async_credential, monkeypatch: pytest.MonkeyPatch
    ):
        """Test VoiceLive auth uses managed identity when Azure runtime markers are present."""
        monkeypatch.setenv("AZURE_CLIENT_ID", "managed-identity-client-id")
        mock_config.get.return_value = "test-api-key"
        mock_async_credential.return_value = Mock()

        handler = VoiceProxyHandler(Mock())
        credential = handler._get_credential()

        assert credential is mock_async_credential.return_value


class TestStructuredConversationEvents:
    """Tests for Stage 8 ``wulo.*`` custom event plumbing."""

    @pytest.mark.asyncio
    async def test_tally_configure_event_is_consumed(self):
        from src.services.scoring import TargetTokenTally

        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()
        tally = TargetTokenTally()

        consumed = await handler._maybe_handle_wulo_client_event(
            {
                "type": "wulo.tally_configure",
                "payload": {
                    "suggestedTargetWords": ["think", "thumb"],
                    "expectedSubstitutions": ["f→th"],
                    "windowSeconds": 30,
                    "minTokensInWindow": 2,
                    "cooldownSeconds": 10,
                },
            },
            tally,
            Mock(),
        )

        assert consumed is True
        # Snapshot emitted to client on configure.
        assert handler._send_message.await_count == 1

    @pytest.mark.asyncio
    async def test_therapist_override_mutates_tally(self):
        from src.services.scoring import TargetTokenTally

        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()
        tally = TargetTokenTally()

        consumed = await handler._maybe_handle_wulo_client_event(
            {
                "type": "wulo.therapist_override",
                "payload": {"correctDelta": 2, "incorrectDelta": 1},
            },
            tally,
            Mock(),
        )

        assert consumed is True
        snap = tally.snapshot()
        assert snap.correct_count == 2
        assert snap.incorrect_count == 1

    @pytest.mark.asyncio
    async def test_non_wulo_event_is_not_consumed(self):
        from src.services.scoring import TargetTokenTally

        handler = VoiceProxyHandler(Mock())
        handler._send_message = AsyncMock()

        consumed = await handler._maybe_handle_wulo_client_event(
            {"type": "input_audio_buffer.append", "audio": "..."},
            TargetTokenTally(),
            Mock(),
        )

        assert consumed is False
        handler._send_message.assert_not_awaited()

    def test_structured_conversation_flag_defaults_off(self, monkeypatch: pytest.MonkeyPatch):
        from src.services.websocket_handler import _is_structured_conversation_enabled

        monkeypatch.delenv("WULO_STRUCTURED_CONVERSATION", raising=False)
        assert _is_structured_conversation_enabled() is False

        monkeypatch.setenv("WULO_STRUCTURED_CONVERSATION", "1")
        assert _is_structured_conversation_enabled() is True

        monkeypatch.setenv("WULO_STRUCTURED_CONVERSATION", "true")
        assert _is_structured_conversation_enabled() is True

        monkeypatch.setenv("WULO_STRUCTURED_CONVERSATION", "0")
        assert _is_structured_conversation_enabled() is False
