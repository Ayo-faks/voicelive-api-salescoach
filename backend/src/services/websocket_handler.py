# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""WebSocket handling for voice proxy connections using Azure AI VoiceLive SDK."""

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

import simple_websocket.ws  # pyright: ignore[reportMissingTypeStubs]
from azure.ai.voicelive.aio import (
    ConnectionClosed,
    ConnectionError as VoiceLiveConnectionError,
    VoiceLiveConnection,
    connect,
)
from azure.ai.voicelive.models import (
    AudioInputTranscriptionOptions,
    AudioEchoCancellation,
    AudioNoiseReduction,
    AvatarConfig,
    AzureSemanticVad,
    AzureStandardVoice,
    Modality,
    RequestSession,
    ServerEventType,
)

from src.config import config
from src.services.azure_openai_auth import build_voicelive_credential
from src.services.managers import AgentManager, FINISH_SESSION_TOOL
from src.services.scoring import TargetTokenTally

logger = logging.getLogger(__name__)

# WebSocket constants
AZURE_VOICE_API_VERSION = "2025-05-01-preview"
AZURE_COGNITIVE_SERVICES_DOMAIN = "cognitiveservices.azure.com"
def _is_local_dev_auth_enabled() -> bool:
    """Resolve LOCAL_DEV_AUTH dynamically so test and shell env changes are honored."""
    return str(os.environ.get("LOCAL_DEV_AUTH", str(config.get("local_dev_auth", False)))).strip().lower() == "true"

# Session configuration defaults
DEFAULT_TURN_DETECTION_TYPE = "azure_semantic_vad"
DEFAULT_NOISE_REDUCTION_TYPE = "azure_deep_noise_suppression"
DEFAULT_ECHO_CANCELLATION_TYPE = "server_echo_cancellation"
DEFAULT_AVATAR_CHARACTER = "meg"
DEFAULT_AVATAR_STYLE = "casual"
PHOTO_AVATAR_DEFAULT_SCENE = {
    "zoom": 0.82,
    "positionX": 0.0,
    "positionY": 0.0,
    "rotationX": 0.0,
    "rotationY": 0.0,
    "rotationZ": 0.0,
    "amplitude": 0.6,
}

# Message types
SESSION_UPDATE_TYPE = "session.update"
PROXY_CONNECTED_TYPE = "proxy.connected"
ERROR_TYPE = "error"

# Stage 8 structured_conversation custom event types (Wulo-namespaced so they
# never collide with Azure Realtime event types).
WULO_TALLY_CONFIGURE_TYPE = "wulo.tally_configure"
WULO_REQUEST_PAUSE_TYPE = "wulo.request_pause"
WULO_REQUEST_RESUME_TYPE = "wulo.request_resume"
WULO_THERAPIST_OVERRIDE_TYPE = "wulo.therapist_override"
WULO_TARGET_TALLY_TYPE = "wulo.target_tally"
WULO_SCAFFOLD_ESCALATE_TYPE = "wulo.scaffold_escalate"

# String match used to identify input transcription completion events from the
# Azure Realtime API (the SDK exposes this as an enum, but matching by string
# avoids a hard dependency on a specific SDK version).
INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE = (
    "conversation.item.input_audio_transcription.completed"
)


def _is_structured_conversation_enabled() -> bool:
    """Feature flag for Stage 8 backend tally layer.

    Default off. Set WULO_STRUCTURED_CONVERSATION=1 (or true) to enable.
    """
    raw = os.environ.get("WULO_STRUCTURED_CONVERSATION", "")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}

# Log message truncation length
LOG_MESSAGE_MAX_LENGTH = 100


class VoiceProxyHandler:
    """Handles WebSocket proxy connections between client and Azure Voice API using VoiceLive SDK."""

    def __init__(self, agent_manager: AgentManager):
        """
        Initialize the voice proxy handler.

        Args:
            agent_manager: Agent manager instance
        """
        self.agent_manager = agent_manager

    async def handle_connection(self, client_ws: simple_websocket.ws.Server) -> None:
        """
        Handle a WebSocket connection from a client.

        Args:
            client_ws: The client WebSocket connection
        """
        current_agent_id = None

        try:
            if not self._has_authenticated_principal(client_ws):
                logger.warning("Rejected WebSocket connection without X-MS-CLIENT-PRINCIPAL-ID")
                await self._send_error(client_ws, "Authentication required")
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.close,  # pyright: ignore[reportUnknownMemberType]
                )
                return

            current_agent_id = await self._get_agent_id_from_client(client_ws)
            agent_config = self.agent_manager.get_agent(current_agent_id) if current_agent_id else None

            endpoint = self._build_endpoint()
            credential = self._get_credential()
            model = self._get_model(agent_config)
            query_params = self._build_query_params(current_agent_id, agent_config)

            if not credential:
                await self._send_error(client_ws, "No API key found in configuration")
                return

            async with connect(
                endpoint=endpoint,
                credential=credential,
                model=model,
                api_version=AZURE_VOICE_API_VERSION,
                query=query_params,
            ) as azure_conn:
                logger.info("Connected to Azure Voice API via SDK with agent: %s", current_agent_id or "default")

                await self._send_message(
                    client_ws,
                    {"type": PROXY_CONNECTED_TYPE, "message": "Connected to Azure Voice API"},
                )

                await self._send_initial_config(azure_conn, agent_config)
                await self._handle_message_forwarding(client_ws, azure_conn)

        except ConnectionClosed as e:
            logger.info("VoiceLive connection closed: code=%s, reason=%s", e.code, e.reason)
        except VoiceLiveConnectionError as e:
            logger.error("VoiceLive connection error: %s", e)
            await self._send_error(client_ws, str(e))
        except Exception as e:
            logger.error("Proxy error: %s", e)
            await self._send_error(client_ws, str(e))

    def _has_authenticated_principal(self, client_ws: simple_websocket.ws.Server) -> bool:
        """Validate that Easy Auth principal headers survived the WebSocket upgrade."""
        if _is_local_dev_auth_enabled():
            return True

        environ = getattr(client_ws, "environ", {}) or {}
        principal_id = str(environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_ID") or "").strip()
        return bool(principal_id)

    async def _get_agent_id_from_client(self, client_ws: simple_websocket.ws.Server) -> Optional[str]:
        """Get agent ID from initial client message."""
        try:
            first_message: str | None = await asyncio.get_event_loop().run_in_executor(
                None,
                client_ws.receive,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
            )
            if first_message:
                msg = json.loads(first_message)
                if msg.get("type") == SESSION_UPDATE_TYPE:
                    return msg.get("session", {}).get("agent_id")
        except Exception as e:
            logger.error("Error getting agent ID: %s", e)
        return None

    def _build_endpoint(self) -> str:
        """Build the Azure endpoint URL."""
        resource_name = config["azure_ai_resource_name"]
        return f"https://{resource_name}.{AZURE_COGNITIVE_SERVICES_DOMAIN}"

    def _get_credential(self) -> Optional[Any]:
        """Get the Azure credential."""
        return build_voicelive_credential(config)

    def _get_model(self, agent_config: Optional[Dict[str, Any]]) -> Optional[str]:
        """Get the model name for the connection."""
        if agent_config and agent_config.get("is_azure_agent"):
            return None
        if agent_config:
            return agent_config.get("model", config["model_deployment_name"])
        if config["agent_id"]:
            return None
        return config["model_deployment_name"]

    def _build_query_params(self, agent_id: Optional[str], agent_config: Optional[Dict[str, Any]]) -> Dict[str, str]:
        """Build additional query parameters for the connection."""
        params: Dict[str, str] = {}

        if agent_config and agent_config.get("is_azure_agent"):
            params["agent-id"] = agent_id or ""
            project_name = config["azure_ai_project_name"]
            if project_name:
                params["agent-project-name"] = project_name
        elif not agent_config and config["agent_id"]:
            params["agent-id"] = config["agent_id"]

        return params

    async def _send_initial_config(
        self,
        azure_conn: VoiceLiveConnection,
        agent_config: Optional[Dict[str, Any]],
    ) -> None:
        """Send initial configuration to Azure using SDK typed models."""
        session_config = self._build_session_config(agent_config)
        await azure_conn.session.update(session=session_config)
        logger.debug("Sent initial session configuration via SDK")

    def _build_session_config(self, agent_config: Optional[Dict[str, Any]]) -> RequestSession:
        """Build the session configuration using SDK typed models."""
        voice_name = config.get("azure_voice_name")
        voice_type = config.get("azure_voice_type")

        avatar_character = config.get("azure_avatar_character", DEFAULT_AVATAR_CHARACTER)
        avatar_style = config.get("azure_avatar_style", DEFAULT_AVATAR_STYLE)
        is_photo_avatar = False

        if agent_config and agent_config.get("avatar_config"):
            custom_avatar = agent_config["avatar_config"]
            avatar_character = custom_avatar.get("character", avatar_character)
            avatar_style = custom_avatar.get("style", avatar_style)
            is_photo_avatar = custom_avatar.get("is_photo_avatar", False)
            voice_name = custom_avatar.get("voice_name") or voice_name

        avatar_config_value = self._build_avatar_config(avatar_character, avatar_style, is_photo_avatar)

        logger.info("Session voice config: voice_name=%s, voice_type=%s, agent_override=%s", voice_name, voice_type, bool(agent_config and agent_config.get("avatar_config", {}).get("voice_name")))

        return self._create_request_session(voice_name, voice_type, avatar_config_value, agent_config)

    def _build_avatar_config(self, character: str, style: str, is_photo: bool) -> Any:
        """Build avatar configuration for photo or video avatars."""
        if is_photo:
            return {
                "type": "photo-avatar",
                "model": "vasa-1",
                "character": character,
                "customized": False,
                "scene": PHOTO_AVATAR_DEFAULT_SCENE,
            }
        return AvatarConfig(
            character=character,
            style=style if style else None,
            customized=False,
        )

    def _create_request_session(
        self,
        voice_name: str,
        voice_type: str,
        avatar_config_value: Any,
        agent_config: Optional[Dict[str, Any]],
    ) -> RequestSession:
        """Create the RequestSession with all configuration."""
        custom_lexicon_url = str(config.get("azure_custom_lexicon_url") or "").strip() or None

        session = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO, Modality.AVATAR],
            turn_detection=AzureSemanticVad(type=DEFAULT_TURN_DETECTION_TYPE),
            input_audio_transcription=AudioInputTranscriptionOptions(
                model=config.get("azure_input_transcription_model", "azure-speech"),
                language=config.get("azure_input_transcription_language", "en-US"),
            ),
            input_audio_noise_reduction=AudioNoiseReduction(type=DEFAULT_NOISE_REDUCTION_TYPE),
            input_audio_echo_cancellation=AudioEchoCancellation(type=DEFAULT_ECHO_CANCELLATION_TYPE),
            voice=AzureStandardVoice(
                name=voice_name,
                type=voice_type,
                custom_lexicon_url=custom_lexicon_url,
            ),
            avatar=avatar_config_value,
            tools=[FINISH_SESSION_TOOL],
        )

        personalization_block = self._build_personalization_instruction_block(agent_config)

        if agent_config and not agent_config.get("is_azure_agent"):
            session["instructions"] = self._combine_instructions(
                agent_config.get("instructions"),
                personalization_block,
            )
            session["temperature"] = agent_config.get("temperature")
            session["max_response_output_tokens"] = agent_config.get("max_tokens")
        elif personalization_block:
            session["instructions"] = personalization_block

        return session

    def _combine_instructions(self, base_instructions: Any, personalization_block: Optional[str]) -> Optional[str]:
        base_text = str(base_instructions or "").strip()
        personalization_text = str(personalization_block or "").strip()

        if base_text and personalization_text:
            return f"{base_text}\n\n{personalization_text}"
        if base_text:
            return base_text
        if personalization_text:
            return personalization_text
        return None

    def _build_personalization_instruction_block(self, agent_config: Optional[Dict[str, Any]]) -> Optional[str]:
        personalization = (agent_config or {}).get("runtime_personalization") or {}
        if not personalization:
            return None

        approved_targets = self._extract_statements(personalization.get("approved_targets"))
        approved_constraints = self._extract_statements(personalization.get("approved_constraints"))
        approved_effective_cues = self._extract_statements(personalization.get("approved_effective_cues"))
        active_target_sound = str(personalization.get("active_target_sound") or "").strip()
        active_target_word = str(personalization.get("active_target_word") or "").strip()
        # Stage 5b word_position_practice: surface expected substitutions so the
        # model gently models the target without flagging the child as wrong.
        expected_subs_raw = personalization.get("expected_substitutions") or []
        expected_substitutions: List[str] = []
        if isinstance(expected_subs_raw, list):
            for item in expected_subs_raw:
                s = str(item or "").strip()
                if s:
                    expected_substitutions.append(s)
        word_position = str(personalization.get("word_position") or "").strip()

        lines: List[str] = [
            "APPROVED CHILD MEMORY FOR THIS SESSION:",
            "- Use only the therapist-approved items below as low-risk guidance.",
            "- Do not invent new policies, labels, or durable memory from this live interaction.",
        ]
        if active_target_sound:
            lines.append(f"- Active target sound: /{active_target_sound}/")
        if active_target_word:
            lines.append(
                f"- Active target word in the current phrase: \"{active_target_word}\" "
                "(coach this word; the other carrier word is neutral)"
            )
        if word_position in {"initial", "medial", "final"}:
            pos_word = {"initial": "start", "medial": "middle", "final": "end"}[word_position]
            lines.append(f"- Target position in the word: {pos_word}")
        if approved_targets:
            lines.append(f"- Approved current targets: {'; '.join(approved_targets)}")
        if approved_constraints:
            lines.append(f"- Approved constraints: {'; '.join(approved_constraints)}")
        if approved_effective_cues:
            lines.append(f"- Approved effective cues: {'; '.join(approved_effective_cues)}")
        if expected_substitutions:
            subs_fmt = ", ".join(f"/{s}/" for s in expected_substitutions)
            lines.append(
                f"- Expected substitutions to gently remodel (never call wrong): {subs_fmt}"
            )

        if len(lines) <= 3:
            return None

        return "\n".join(lines)

    def _extract_statements(self, items: Any) -> List[str]:
        statements: List[str] = []
        for item in items or []:
            statement = str((item or {}).get("statement") or "").strip()
            if statement:
                statements.append(statement)
        return statements

    async def _handle_message_forwarding(
        self,
        client_ws: simple_websocket.ws.Server,
        azure_conn: VoiceLiveConnection,
    ) -> None:
        """Handle bidirectional message forwarding."""
        tally: Optional[TargetTokenTally] = (
            TargetTokenTally() if _is_structured_conversation_enabled() else None
        )
        tasks = [
            asyncio.create_task(self._forward_client_to_azure(client_ws, azure_conn, tally)),
            asyncio.create_task(self._forward_azure_to_client(azure_conn, client_ws, tally)),
        ]

        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()

    async def _forward_client_to_azure(
        self,
        client_ws: simple_websocket.ws.Server,
        azure_conn: VoiceLiveConnection,
        tally: Optional[TargetTokenTally] = None,
    ) -> None:
        """Forward messages from client to Azure using SDK.

        When Stage 8 is enabled, intercept ``wulo.*`` events so they never
        reach Azure; they only mutate the per-connection tally state.
        """
        try:
            while True:
                message: Optional[Any] = await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.receive,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
                )
                if message is None:
                    break

                logger.debug("Client->Azure: %s", str(message)[:LOG_MESSAGE_MAX_LENGTH])

                if isinstance(message, str):
                    parsed = json.loads(message)
                    if tally is not None and await self._maybe_handle_wulo_client_event(
                        parsed, tally, client_ws
                    ):
                        continue
                    await azure_conn.send(parsed)
                else:
                    await azure_conn.send(message)

        except ConnectionClosed:
            logger.debug("Azure connection closed during client forwarding")
        except Exception as e:
            logger.debug("Client connection closed during forwarding: %s", e)

    async def _maybe_handle_wulo_client_event(
        self,
        parsed: Dict[str, Any],
        tally: TargetTokenTally,
        client_ws: simple_websocket.ws.Server,
    ) -> bool:
        """Handle client-side Stage 8 custom events. Returns True if consumed."""
        event_type = str(parsed.get("type") or "")
        if event_type == WULO_TALLY_CONFIGURE_TYPE:
            payload = parsed.get("payload") or {}
            tally.configure(
                suggested_target_words=payload.get("suggestedTargetWords"),
                expected_substitutions=payload.get("expectedSubstitutions"),
                window_seconds=payload.get("windowSeconds"),
                min_tokens_in_window=payload.get("minTokensInWindow"),
                cooldown_seconds=payload.get("cooldownSeconds"),
            )
            await self._emit_tally_snapshot(client_ws, tally)
            return True
        if event_type == WULO_REQUEST_PAUSE_TYPE:
            tally.mark_paused()
            return True
        if event_type == WULO_REQUEST_RESUME_TYPE:
            # Resume is a frontend state; backend just acknowledges via a
            # fresh snapshot.
            await self._emit_tally_snapshot(client_ws, tally)
            return True
        if event_type == WULO_THERAPIST_OVERRIDE_TYPE:
            payload = parsed.get("payload") or {}
            try:
                correct = int(payload.get("correctDelta", 0) or 0)
                incorrect = int(payload.get("incorrectDelta", 0) or 0)
            except (TypeError, ValueError):
                correct, incorrect = 0, 0
            tally.apply_override(correct=correct, incorrect=incorrect)
            await self._emit_tally_snapshot(client_ws, tally)
            return True
        return False

    async def _emit_tally_snapshot(
        self,
        client_ws: simple_websocket.ws.Server,
        tally: TargetTokenTally,
    ) -> None:
        """Emit a wulo.target_tally event and possibly wulo.scaffold_escalate."""
        snapshot = tally.snapshot().to_dict()
        await self._send_message(
            client_ws,
            {"type": WULO_TARGET_TALLY_TYPE, "payload": snapshot},
        )
        escalation = tally.check_escalation()
        if escalation is not None:
            await self._send_message(
                client_ws,
                {"type": WULO_SCAFFOLD_ESCALATE_TYPE, "payload": escalation},
            )

    async def _forward_azure_to_client(
        self,
        azure_conn: VoiceLiveConnection,
        client_ws: simple_websocket.ws.Server,
        tally: Optional[TargetTokenTally] = None,
    ) -> None:
        """Forward messages from Azure to client using SDK typed events.

        When Stage 8 is enabled, inspect completed input transcription events
        to feed the tally and emit wulo.target_tally / wulo.scaffold_escalate.
        """
        try:
            async for event in azure_conn:
                event_dict = event.as_dict() if hasattr(event, "as_dict") else dict(event)
                message = json.dumps(event_dict)
                logger.debug("Azure->Client: %s", message[:LOG_MESSAGE_MAX_LENGTH])

                await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.send,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
                    message,
                )

                if event.type == ServerEventType.ERROR:
                    logger.warning("Azure error event: %s", event_dict)
                elif event.type == ServerEventType.SESSION_CREATED:
                    logger.info("Session created: %s", event_dict.get("session", {}).get("id"))
                elif event.type == ServerEventType.SESSION_UPDATED:
                    logger.info("Session updated")

                if tally is not None:
                    event_type_str = str(event_dict.get("type") or "")
                    if event_type_str == INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE:
                        transcript = str(event_dict.get("transcript") or "").strip()
                        if transcript:
                            tally.ingest_transcript(transcript)
                        await self._emit_tally_snapshot(client_ws, tally)

        except ConnectionClosed as e:
            logger.debug("Azure connection closed: code=%s, reason=%s", e.code, e.reason)
        except Exception as e:
            logger.debug("Error forwarding Azure messages: %s", e)

    async def _send_message(self, ws: simple_websocket.ws.Server, message: Dict[str, str | Dict[str, str]]) -> None:
        """Send a JSON message to a WebSocket."""
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                ws.send,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
                json.dumps(message),
            )
        except Exception:
            pass

    async def _send_error(self, ws: simple_websocket.ws.Server, error_message: str) -> None:
        """Send an error message to a WebSocket."""
        await self._send_message(ws, {"type": ERROR_TYPE, "error": {"message": error_message}})
