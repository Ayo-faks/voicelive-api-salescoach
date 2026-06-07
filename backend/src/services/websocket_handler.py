# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""WebSocket handling for voice proxy connections using Azure AI VoiceLive SDK."""

import asyncio
import json
import logging
import os
from urllib.parse import parse_qs
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
    AzureSemanticVadEn,
    AzureStandardVoice,
    InputAudioFormat,
    Modality,
    OutputAudioFormat,
    RequestSession,
    ServerEventType,
)

from src.config import config
from src.safeguarding import Direction as SafeguardingDirection
from src.safeguarding import get_safeguarding_service
from src.services.azure_openai_auth import build_voicelive_credential
from src.services.managers import AgentManager, FINISH_SESSION_TOOL
from src.services.prompt_rules import append_phoneme_rule
from src.services.scoring import ScoredTurnDispatcher, TargetTokenTally
from src.services.tts_normalizer import normalize_for_tts
from src.services.voice_agent_profiles import AgentProfile, AgentProfileContext, get_profile

logger = logging.getLogger(__name__)

# WebSocket constants
AZURE_VOICE_API_VERSION = "2025-05-01-preview"
AZURE_COGNITIVE_SERVICES_DOMAIN = "cognitiveservices.azure.com"

# Learner-scoped profiles share audio-only modality, the profile voice, and the
# profile instruction block (no on-screen avatar). ``learner`` walks practice
# cards; ``learner_ask`` is the ask-anything AskPathfinder voice surface.
LEARNER_VOICE_PROFILE_IDS = frozenset({"learner", "learner_ask"})


def _is_local_dev_auth_enabled() -> bool:
    """Resolve LOCAL_DEV_AUTH dynamically so test and shell env changes are honored."""
    return str(os.environ.get("LOCAL_DEV_AUTH", str(config.get("local_dev_auth", False)))).strip().lower() == "true"


# Session configuration defaults
DEFAULT_TURN_DETECTION_TYPE = "azure_semantic_vad"
DEFAULT_CONVERSATIONAL_TURN_DETECTION_TYPE = "azure_semantic_vad_en"
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

# Learner Dig-Deeper grounding: map the realtime taxonomy onto the curriculum
# corpus axes so a focus item can be pre-warmed against the bundled wiki seeds
# before the first tool call. Mirrors the REST/turn-based planner mapping.
_FOCUS_SUBJECT_TO_CORPUS = {"Mathematics": "maths", "English Language": "english"}
_FOCUS_CLASS_TO_YEAR_GROUP = {
    "JSS2": "JSS3",
    "JSS3": "JSS3",
    "SSS1": "SS3",
    "SSS2": "SS3",
    "SSS3": "SS3",
}
_LEARNER_FOCUS_RETRIEVER: Any = None
_LEARNER_FOCUS_RETRIEVER_LOADED = False


def _get_learner_focus_retriever() -> Any:
    """Lazily build (and cache) the shared curriculum retriever for grounding.

    Loaded on first learner focus injection only — never at import — so the
    bundled wiki corpus is not read for practice sessions. Returns ``None`` on
    any failure so grounding degrades gracefully (the model still has the focus
    anchor + get_next_card tool).
    """
    global _LEARNER_FOCUS_RETRIEVER, _LEARNER_FOCUS_RETRIEVER_LOADED
    if _LEARNER_FOCUS_RETRIEVER_LOADED:
        return _LEARNER_FOCUS_RETRIEVER
    _LEARNER_FOCUS_RETRIEVER_LOADED = True
    try:
        from src.learning.rag import build_default_retriever

        _LEARNER_FOCUS_RETRIEVER = build_default_retriever()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to build learner focus retriever; grounding disabled")
        _LEARNER_FOCUS_RETRIEVER = None
    return _LEARNER_FOCUS_RETRIEVER


# Stage 8 structured_conversation custom event types (Wulo-namespaced so they
# never collide with Azure Realtime event types).
WULO_TALLY_CONFIGURE_TYPE = "wulo.tally_configure"
WULO_REQUEST_PAUSE_TYPE = "wulo.request_pause"
WULO_REQUEST_RESUME_TYPE = "wulo.request_resume"
WULO_THERAPIST_OVERRIDE_TYPE = "wulo.therapist_override"
WULO_TARGET_TALLY_TYPE = "wulo.target_tally"
WULO_SCAFFOLD_ESCALATE_TYPE = "wulo.scaffold_escalate"

# PR12b mic-mode hybrid. When the conversational flag is enabled, the frontend
# can request a per-turn mode ("conversational" keeps the mic open with
# continuous VAD; "tap" preserves the legacy push-to-talk path) and announce a
# scored-turn window around a specific target word. These message types are
# Wulo-namespaced to avoid collisions with Azure Realtime event types.
WULO_MIC_MODE_TYPE = "wulo.mic_mode"
WULO_SCORED_TURN_BEGIN_TYPE = "wulo.scored_turn.begin"
WULO_SCORED_TURN_END_TYPE = "wulo.scored_turn.end"
WULO_SCORED_TURN_ACK_TYPE = "wulo.scored_turn.ack"
WULO_SCORED_TURN_RESULT_TYPE = "wulo.scored_turn.result"

# Avatar saturation / unavailable surfacing. When Azure Voice Live returns
# ``avatar_service_resource_exhausted`` for an error event, we translate it
# into a Wulo-namespaced frame so the UI can show a human-readable banner
# rather than silently spinning.
WULO_AVATAR_RETRYING_TYPE = "wulo.avatar_retrying"
WULO_AVATAR_UNAVAILABLE_TYPE = "wulo.avatar_unavailable"
AVATAR_RESOURCE_EXHAUSTED_CODE = "avatar_service_resource_exhausted"
MAX_AVATAR_ATTEMPTS = 3

# String match used to identify input transcription completion events from the
# Azure Realtime API (the SDK exposes this as an enum, but matching by string
# avoids a hard dependency on a specific SDK version).
INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE = "conversation.item.input_audio_transcription.completed"
RESPONSE_AUDIO_TRANSCRIPT_DONE_TYPE = "response.audio_transcript.done"

# Sent to the frontend when a CRITICAL inbound safeguarding event fires. The
# frontend is responsible for closing the WebRTC session and surfacing the
# pre-approved avatar handoff line in the UI.
WULO_SAFEGUARDING_PAUSE_TYPE = "wulo.safeguarding_pause"
SAFEGUARDING_PAUSE_AVATAR_LINE = (
    "Thank you for telling me that. Let's take a little break — "
    "I've let a grown-up know so they can help."
)


def _is_structured_conversation_enabled() -> bool:
    """Feature flag for Stage 8 backend tally layer.

    Default off. Set WULO_STRUCTURED_CONVERSATION=1 (or true) to enable.
    """
    raw = os.environ.get("WULO_STRUCTURED_CONVERSATION", "")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _is_conversational_mic_enabled() -> bool:
    """Feature flag for PR12b two-mode mic hybrid.

    Dynamic env lookup (mirrors ``_is_structured_conversation_enabled``) so
    tests and per-deployment overrides are honored without a process restart.
    Default off — when off, ``_build_session_config`` preserves the exact
    legacy ``AzureSemanticVad(type=...)`` snapshot.
    """
    env_raw = os.environ.get("CONVERSATIONAL_MIC_ENABLED")
    if env_raw is not None:
        return str(env_raw).strip().lower() in {"1", "true", "yes", "on"}
    return bool(config.get("conversational_mic_enabled", False))


def _build_conversational_turn_detection() -> AzureSemanticVadEn:
    """Build an English semantic VAD with threshold/silence tunables + barge-in.

    Used when the conversational mic flag is enabled. Values are read from
    config so a deployment can tune sensitivity without a code change.
    """
    return AzureSemanticVadEn(
        type=DEFAULT_CONVERSATIONAL_TURN_DETECTION_TYPE,
        threshold=float(config.get("semantic_vad_threshold", 0.5)),
        prefix_padding_ms=int(config.get("semantic_vad_prefix_padding_ms", 300)),
        silence_duration_ms=int(config.get("semantic_vad_silence_duration_ms", 600)),
        interrupt_response=True,
        create_response=True,
    )


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

            profile_context = self._get_profile_context(client_ws)
            profile = get_profile(profile_context.scope)
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

                await self._send_initial_config(azure_conn, agent_config, profile, profile_context)
                await self._handle_message_forwarding(client_ws, azure_conn, profile, profile_context)

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

    def _principal_id(self, client_ws: simple_websocket.ws.Server) -> Optional[str]:
        environ = getattr(client_ws, "environ", {}) or {}
        pid = str(environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_ID") or "").strip()
        return pid or None

    def _dispatch_safeguarding(
        self,
        text: str,
        *,
        direction: "SafeguardingDirection",
        user_id: Optional[str],
        child_id: Optional[str],
        session_id: Optional[str],
        client_ws: Optional["simple_websocket.ws.Server"] = None,
        halt_event: Optional[asyncio.Event] = None,
    ) -> None:
        """Fire-and-forget safeguarding analysis.

        Never raises into the realtime forwarding loop — a detector or DB
        failure must not interrupt the child's session.
        """
        service = get_safeguarding_service()
        if service is None or not service.enabled:
            return
        try:
            asyncio.create_task(
                self._safeguarding_task(
                    service,
                    text=text,
                    direction=direction,
                    user_id=user_id,
                    child_id=child_id,
                    session_id=session_id,
                    client_ws=client_ws,
                    halt_event=halt_event,
                )
            )
        except RuntimeError:
            # No running loop (e.g. tests calling synchronously). Swallow.
            logger.debug("Safeguarding dispatch skipped: no running event loop")
        except Exception:  # noqa: BLE001
            logger.exception("Safeguarding dispatch failed")

    async def _safeguarding_task(
        self,
        service,
        *,
        text: str,
        direction: "SafeguardingDirection",
        user_id: Optional[str],
        child_id: Optional[str],
        session_id: Optional[str],
        client_ws: Optional["simple_websocket.ws.Server"],
        halt_event: Optional[asyncio.Event] = None,
    ) -> None:
        try:
            event = await service.process_utterance(
                text=text,
                direction=direction,
                user_id=user_id,
                child_id=child_id,
                parent_user_id=user_id,
                session_id=session_id,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Safeguarding pipeline raised in task")
            return
        if event is None or event.severity != "critical":
            return

        # A CRITICAL verdict in EITHER direction halts the session server-side:
        # inbound means the child disclosed something requiring an adult; outbound
        # means the model produced unsafe content. Halting does not rely on the
        # client honouring an advisory pause — we set the shared halt flag so the
        # forwarding loops stop relaying, then tear the connection down.
        if halt_event is not None and not halt_event.is_set():
            halt_event.set()

        if client_ws is not None:
            try:
                await self._send_message(
                    client_ws,
                    {
                        "type": WULO_SAFEGUARDING_PAUSE_TYPE,
                        "payload": {
                            "event_id": event.id,
                            "avatar_line": SAFEGUARDING_PAUSE_AVATAR_LINE,
                            "reason": "critical_safeguarding_event",
                            "direction": direction.value,
                        },
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to emit safeguarding pause to client")

        # Force teardown so neither the child nor the model can continue the
        # turn even if the client ignores the pause message.
        if client_ws is not None:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.close,  # pyright: ignore[reportUnknownMemberType]
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to close client socket after critical safeguarding event")

    def _get_profile_context(self, client_ws: simple_websocket.ws.Server) -> AgentProfileContext:
        environ = getattr(client_ws, "environ", {}) or {}
        query = parse_qs(str(environ.get("QUERY_STRING") or ""), keep_blank_values=False)

        def first(name: str, default: str | None = None) -> str | None:
            value = str((query.get(name) or [default or ""])[0] or "").strip()
            return value or default

        scope = first("scope", "practice") or "practice"
        scored_raw = first("focus_scored")
        focus_scored: bool | None = None
        if scored_raw is not None:
            focus_scored = scored_raw.strip().lower() in {"1", "true", "yes", "on"}
        return AgentProfileContext(
            scope=scope,
            child_id=first("child_id"),
            exam=first("exam"),
            class_year=first("class_year"),
            subject=first("subject"),
            focus_stem=first("focus_stem"),
            focus_skill_id=first("focus_skill_id"),
            focus_topic=first("focus_topic"),
            focus_misconception=first("focus_misconception"),
            focus_scored=focus_scored,
        )

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
        voice_live_model = config.get("voice_live_model") or config["model_deployment_name"]
        if agent_config and agent_config.get("is_azure_agent"):
            return None
        if agent_config:
            return agent_config.get("model", voice_live_model)
        if config["agent_id"]:
            return None
        return voice_live_model

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
        profile: AgentProfile | None = None,
        profile_context: AgentProfileContext | None = None,
    ) -> None:
        """Send initial configuration to Azure using SDK typed models."""
        session_config = self._build_session_config(agent_config, profile, profile_context)
        await azure_conn.session.update(session=session_config)
        logger.debug("Sent initial session configuration via SDK")

    def _build_session_config(
        self,
        agent_config: Optional[Dict[str, Any]],
        profile: AgentProfile | None = None,
        profile_context: AgentProfileContext | None = None,
    ) -> RequestSession:
        """Build the session configuration using SDK typed models."""
        profile = profile or get_profile("practice")
        profile_context = profile_context or AgentProfileContext(scope=profile.id)
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

        if profile.id in LEARNER_VOICE_PROFILE_IDS:
            voice_name = profile.voice

        avatar_config_value = self._build_avatar_config(avatar_character, avatar_style, is_photo_avatar)

        logger.info(
            "Session voice config: voice_name=%s, voice_type=%s, agent_override=%s",
            voice_name,
            voice_type,
            bool(agent_config and agent_config.get("avatar_config", {}).get("voice_name")),
        )

        return self._create_request_session(voice_name, voice_type, avatar_config_value, agent_config, profile, profile_context)

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
        profile: AgentProfile | None = None,
        profile_context: AgentProfileContext | None = None,
    ) -> RequestSession:
        """Create the RequestSession with all configuration."""
        profile = profile or get_profile("practice")
        profile_context = profile_context or AgentProfileContext(scope=profile.id)
        custom_lexicon_url = str(config.get("azure_custom_lexicon_url") or "").strip() or None

        if _is_conversational_mic_enabled():
            turn_detection: Any = _build_conversational_turn_detection()
        else:
            turn_detection = AzureSemanticVad(type=DEFAULT_TURN_DETECTION_TYPE)

        # Learner tutor is audio-only (no on-screen avatar). When the AVATAR
        # modality + avatar config are included, Azure routes synthesized speech
        # through the avatar/WebRTC stream and does not emit
        # `response.audio.delta` frames over the realtime websocket, so the
        # browser never hears the tutor. Practice/teacher flows keep the avatar.
        is_audio_only_profile = profile.id in LEARNER_VOICE_PROFILE_IDS
        if is_audio_only_profile:
            modalities: list[Modality] = [Modality.TEXT, Modality.AUDIO]
            avatar_for_session: Any = None
        else:
            modalities = [Modality.TEXT, Modality.AUDIO, Modality.AVATAR]
            avatar_for_session = avatar_config_value

        session = RequestSession(
            modalities=modalities,
            turn_detection=turn_detection,
            input_audio_transcription=AudioInputTranscriptionOptions(
                model=config.get("azure_input_transcription_model", "azure-speech"),
                language=config.get("azure_input_transcription_language", "en-US"),
            ),
            input_audio_sampling_rate=24000,
            input_audio_format=InputAudioFormat.PCM16,
            output_audio_format=OutputAudioFormat.PCM16,
            input_audio_noise_reduction=AudioNoiseReduction(type=DEFAULT_NOISE_REDUCTION_TYPE),
            input_audio_echo_cancellation=AudioEchoCancellation(type=DEFAULT_ECHO_CANCELLATION_TYPE),
            voice=AzureStandardVoice(
                name=voice_name,
                type=voice_type,
                custom_lexicon_url=custom_lexicon_url,
            ),
            avatar=avatar_for_session,
            tools=list(profile.tools or [FINISH_SESSION_TOOL]),
        )

        personalization_block = self._build_personalization_instruction_block(agent_config)

        if profile.id in LEARNER_VOICE_PROFILE_IDS:
            session["instructions"] = append_phoneme_rule(
                self._build_profile_instruction_block(profile, profile_context)
            )
            session["temperature"] = profile.temperature
            session["max_response_output_tokens"] = profile.max_response_output_tokens
        elif agent_config and not agent_config.get("is_azure_agent"):
            session["instructions"] = self._combine_instructions(
                agent_config.get("instructions"),
                personalization_block,
            )
            session["temperature"] = agent_config.get("temperature")
            session["max_response_output_tokens"] = agent_config.get("max_tokens")
        elif personalization_block:
            session["instructions"] = personalization_block

        return session

    def _build_profile_instruction_block(
        self,
        profile: AgentProfile,
        profile_context: AgentProfileContext,
    ) -> str:
        context_lines = [
            "SESSION CONTEXT:",
            f"- child_id: {profile_context.child_id or 'unknown'}",
            f"- exam: {profile_context.exam or 'default'}",
            f"- class_year: {profile_context.class_year or 'default'}",
            f"- subject: {profile_context.subject or 'default'}",
        ]
        block = f"{profile.system_prompt.strip()}\n\n" + "\n".join(context_lines)
        focus_block = self._build_focus_instruction_block(profile_context)
        if focus_block:
            block = f"{block}\n\n{focus_block}"
        return block

    def _build_focus_instruction_block(
        self,
        profile_context: AgentProfileContext,
    ) -> str | None:
        """Anchor the realtime tutor on the learner's Dig-Deeper focus item.

        When the learner arrives on a specific question we (a) state the item so
        the model stays on it, (b) keep guidance Socratic while the item is
        unscored (never hand over the answer mid-assessment), and (c) pre-warm
        the curriculum corpus so factual claims are grounded BEFORE the first
        ``get_next_card`` tool call. Every injected source traces to a retrieval
        hit; if nothing grounds we still anchor on the item and let the model
        defer rather than invent.
        """
        stem = (profile_context.focus_stem or "").strip()
        skill_id = (profile_context.focus_skill_id or "").strip()
        topic = (profile_context.focus_topic or "").strip()
        misconception = (profile_context.focus_misconception or "").strip()
        if not (stem or skill_id or topic):
            return None

        lines: List[str] = ["DIG-DEEPER FOCUS ITEM:"]
        if stem:
            lines.append(f"- The learner is working through: {stem}")
        if topic:
            lines.append(f"- Topic: {topic}")
        if skill_id:
            lines.append(f"- Skill: {skill_id}")
        if misconception:
            lines.append(f"- Watch for this misconception: {misconception}")
        if profile_context.focus_scored is False:
            lines.append(
                "- This item is NOT yet scored: stay Socratic — guide with hints "
                "and questions, never reveal the final answer until it is scored."
            )
        elif profile_context.focus_scored is True:
            lines.append(
                "- This item is already scored: you may explain it fully and walk "
                "through the worked solution."
            )

        sources = self._retrieve_focus_sources(profile_context, query=stem or topic or skill_id)
        if sources:
            lines.append("")
            lines.append(
                "GROUNDING SOURCES (cite as [S1], [S2]; state only what these "
                "support — if a fact is not here, say you are not sure):"
            )
            for index, snippet in enumerate(sources, start=1):
                lines.append(f"[S{index}] {snippet}")
        else:
            lines.append("")
            lines.append(
                "No curriculum source was retrieved for this item — explain only "
                "from the item itself and say you are not sure rather than guess."
            )
        return "\n".join(lines)

    def _retrieve_focus_sources(
        self,
        profile_context: AgentProfileContext,
        *,
        query: str,
        limit: int = 3,
    ) -> List[str]:
        query = (query or "").strip()
        if not query:
            return []
        retriever = _get_learner_focus_retriever()
        if retriever is None:
            return []
        subject = _FOCUS_SUBJECT_TO_CORPUS.get((profile_context.subject or "").strip())
        year_group = _FOCUS_CLASS_TO_YEAR_GROUP.get((profile_context.class_year or "").strip())
        try:
            from src.learning.rag import retrieve_or_refuse

            hits, _refusal = retrieve_or_refuse(
                retriever,
                query,
                subject=subject,  # type: ignore[arg-type]
                year_group=year_group,  # type: ignore[arg-type]
            )
        except Exception:  # noqa: BLE001
            logger.exception("Focus grounding retrieval failed; continuing ungrounded")
            return []
        snippets: List[str] = []
        for hit in hits[:limit]:
            body = str(getattr(getattr(hit, "node", None), "body_markdown", "") or "").strip()
            if body:
                snippets.append(body)
        return snippets


    def _combine_instructions(self, base_instructions: Any, personalization_block: Optional[str]) -> Optional[str]:
        base_text = str(base_instructions or "").strip()
        personalization_text = str(personalization_block or "").strip()

        if base_text and personalization_text:
            combined = f"{base_text}\n\n{personalization_text}"
        elif base_text:
            combined = base_text
        elif personalization_text:
            combined = personalization_text
        else:
            return None

        # Append the phoneme citation rule *after* personalisation so it is
        # not overwritten or diluted by per-session targets/constraints.
        return append_phoneme_rule(combined)

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
                f'- Active target word in the current phrase: "{active_target_word}" '
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
            lines.append(f"- Expected substitutions to gently remodel (never call wrong): {subs_fmt}")

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
        profile: AgentProfile | None = None,
        profile_context: AgentProfileContext | None = None,
    ) -> None:
        """Handle bidirectional message forwarding."""
        profile = profile or get_profile("practice")
        profile_context = profile_context or AgentProfileContext(scope=profile.id)
        tally: Optional[TargetTokenTally] = TargetTokenTally() if _is_structured_conversation_enabled() else None
        scored_turn: Optional[ScoredTurnDispatcher] = (
            ScoredTurnDispatcher() if _is_conversational_mic_enabled() else None
        )
        halt_event = asyncio.Event()
        tasks = [
            asyncio.create_task(
                self._forward_client_to_azure(
                    client_ws, azure_conn, tally, scored_turn, profile, halt_event=halt_event
                )
            ),
            asyncio.create_task(
                self._forward_azure_to_client(
                    azure_conn, client_ws, tally, scored_turn, profile, profile_context, halt_event=halt_event
                )
            ),
        ]

        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()

    async def _forward_client_to_azure(
        self,
        client_ws: simple_websocket.ws.Server,
        azure_conn: VoiceLiveConnection,
        tally: Optional[TargetTokenTally] = None,
        scored_turn: Optional[ScoredTurnDispatcher] = None,
        profile: AgentProfile | None = None,
        halt_event: Optional[asyncio.Event] = None,
    ) -> None:
        """Forward messages from client to Azure using SDK.

        When Stage 8 is enabled, intercept ``wulo.*`` events so they never
        reach Azure; they only mutate the per-connection tally state.
        """
        try:
            while True:
                if halt_event is not None and halt_event.is_set():
                    break
                message: Optional[Any] = await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.receive,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
                )
                if message is None:
                    break
                if halt_event is not None and halt_event.is_set():
                    break

                logger.debug("Client->Azure: %s", str(message)[:LOG_MESSAGE_MAX_LENGTH])

                if isinstance(message, str):
                    parsed = json.loads(message)
                    if tally is not None and await self._maybe_handle_wulo_client_event(parsed, tally, client_ws):
                        continue
                    if scored_turn is not None and await self._maybe_handle_scored_turn_client_event(
                        parsed, scored_turn, client_ws
                    ):
                        continue
                    self._normalize_outbound_text_fields(parsed)
                    self._apply_profile_response_tool_choice(parsed, profile)
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

    async def _maybe_handle_scored_turn_client_event(
        self,
        parsed: Dict[str, Any],
        scored_turn: ScoredTurnDispatcher,
        client_ws: simple_websocket.ws.Server,
    ) -> bool:
        """Handle PR12b.3 scored-turn client events. Returns True if consumed.

        Also swallows ``wulo.mic_mode`` (frontend-only preference broadcast so
        analytics can see the mode choice — no server-side action required yet).
        """
        event_type = str(parsed.get("type") or "")
        if event_type == WULO_MIC_MODE_TYPE:
            # Logged only; mode selection is a frontend concern for now.
            logger.debug("Received wulo.mic_mode: %s", parsed.get("payload"))
            return True
        if event_type == WULO_SCORED_TURN_BEGIN_TYPE:
            payload = parsed.get("payload") or {}
            turn_id = str(payload.get("turnId") or "").strip()
            target_word = str(payload.get("targetWord") or "").strip()
            if not turn_id or not target_word:
                return True
            preempted = scored_turn.begin(
                turn_id=turn_id,
                target_word=target_word,
                reference_text=payload.get("referenceText"),
                window_ms=payload.get("windowMs"),
            )
            if preempted is not None:
                await self._send_message(
                    client_ws,
                    {"type": WULO_SCORED_TURN_RESULT_TYPE, "payload": preempted.to_dict()},
                )
            await self._send_message(
                client_ws,
                {
                    "type": WULO_SCORED_TURN_ACK_TYPE,
                    "payload": {"turnId": turn_id, "targetWord": target_word},
                },
            )
            return True
        if event_type == WULO_SCORED_TURN_END_TYPE:
            payload = parsed.get("payload") or {}
            turn_id = str(payload.get("turnId") or "").strip()
            if not turn_id:
                return True
            cancelled = scored_turn.end(turn_id)
            if cancelled is not None:
                await self._send_message(
                    client_ws,
                    {"type": WULO_SCORED_TURN_RESULT_TYPE, "payload": cancelled.to_dict()},
                )
            return True
        return False

    async def _forward_azure_to_client(
        self,
        azure_conn: VoiceLiveConnection,
        client_ws: simple_websocket.ws.Server,
        tally: Optional[TargetTokenTally] = None,
        scored_turn: Optional[ScoredTurnDispatcher] = None,
        profile: AgentProfile | None = None,
        profile_context: AgentProfileContext | None = None,
        halt_event: Optional[asyncio.Event] = None,
    ) -> None:
        """Forward messages from Azure to client using SDK typed events.

        When Stage 8 is enabled, inspect completed input transcription events
        to feed the tally and emit wulo.target_tally / wulo.scaffold_escalate.
        """
        avatar_retry_attempts = 0
        avatar_surrendered = False
        profile_tool_response_pending = False
        handled_profile_tool_call_ids: set[str] = set()
        azure_session_id: Optional[str] = None
        principal_id = self._principal_id(client_ws)
        try:
            async for event in azure_conn:
                # A critical safeguarding verdict (set asynchronously) stops the
                # model's audio/text from reaching the child immediately, before
                # the connection is fully torn down.
                if halt_event is not None and halt_event.is_set():
                    break
                event_dict = event.as_dict() if hasattr(event, "as_dict") else dict(event)
                if profile is not None and profile_context is not None:
                    if await self._maybe_handle_profile_tool_call(
                        event_dict,
                        azure_conn,
                        client_ws,
                        profile,
                        profile_context,
                        handled_profile_tool_call_ids,
                    ):
                        profile_tool_response_pending = True
                        continue
                message = json.dumps(event_dict)
                logger.debug("Azure->Client: %s", message[:LOG_MESSAGE_MAX_LENGTH])

                await asyncio.get_event_loop().run_in_executor(
                    None,
                    client_ws.send,  # pyright: ignore[reportUnknownArgumentType,reportUnknownMemberType]
                    message,
                )

                if event.type == ServerEventType.ERROR:
                    logger.warning("Azure error event: %s", event_dict)
                    error_obj = event_dict.get("error") or {}
                    error_code = str(error_obj.get("code") or "")
                    if error_code == AVATAR_RESOURCE_EXHAUSTED_CODE and not avatar_surrendered:
                        avatar_retry_attempts += 1
                        error_message = str(error_obj.get("message") or "Azure avatar service is currently saturated.")
                        if avatar_retry_attempts >= MAX_AVATAR_ATTEMPTS:
                            avatar_surrendered = True
                            await self._send_message(
                                client_ws,
                                {
                                    "type": WULO_AVATAR_UNAVAILABLE_TYPE,
                                    "payload": {
                                        "attempts": avatar_retry_attempts,
                                        "error_code": error_code,
                                        "message": error_message,
                                    },
                                },
                            )
                        else:
                            await self._send_message(
                                client_ws,
                                {
                                    "type": WULO_AVATAR_RETRYING_TYPE,
                                    "payload": {
                                        "attempt": avatar_retry_attempts,
                                        "max_attempts": MAX_AVATAR_ATTEMPTS,
                                        "error_code": error_code,
                                        "message": error_message,
                                    },
                                },
                            )
                elif event.type == ServerEventType.SESSION_CREATED:
                    azure_session_id = str(event_dict.get("session", {}).get("id") or "") or azure_session_id
                    logger.info("Session created: %s", azure_session_id)
                elif event.type == ServerEventType.SESSION_UPDATED:
                    logger.info("Session updated")

                event_type_str = str(event_dict.get("type") or "")
                if event_type_str == INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE:
                    transcript_for_guard = str(event_dict.get("transcript") or "").strip()
                    if transcript_for_guard:
                        self._dispatch_safeguarding(
                            transcript_for_guard,
                            direction=SafeguardingDirection.INBOUND,
                            user_id=principal_id,
                            child_id=(profile_context.child_id if profile_context else None),
                            session_id=azure_session_id,
                            client_ws=client_ws,
                            halt_event=halt_event,
                        )
                elif event_type_str == RESPONSE_AUDIO_TRANSCRIPT_DONE_TYPE:
                    outbound_transcript = str(event_dict.get("transcript") or "").strip()
                    if outbound_transcript:
                        self._dispatch_safeguarding(
                            outbound_transcript,
                            direction=SafeguardingDirection.OUTBOUND,
                            user_id=principal_id,
                            child_id=(profile_context.child_id if profile_context else None),
                            session_id=azure_session_id,
                            client_ws=client_ws,
                            halt_event=halt_event,
                        )
                if tally is not None:
                    if event_type_str == INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE:
                        transcript = str(event_dict.get("transcript") or "").strip()
                        if transcript:
                            tally.ingest_transcript(transcript)
                        await self._emit_tally_snapshot(client_ws, tally)

                if scored_turn is not None and scored_turn.is_active():
                    # Resolve on transcription completion; otherwise check if
                    # the window has elapsed and emit a timeout.
                    result = None
                    if event_type_str == INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE:
                        transcript = str(event_dict.get("transcript") or "").strip()
                        result = scored_turn.ingest_transcript(transcript)
                    if result is None:
                        result = scored_turn.check_timeout()
                    if result is not None:
                        await self._send_message(
                            client_ws,
                            {"type": WULO_SCORED_TURN_RESULT_TYPE, "payload": result.to_dict()},
                        )

                if event_type_str == "response.done" and profile_tool_response_pending:
                    profile_tool_response_pending = False
                    await azure_conn.send(self._build_profile_tool_response_create(profile))

        except ConnectionClosed as e:
            logger.debug("Azure connection closed: code=%s, reason=%s", e.code, e.reason)
        except Exception as e:
            logger.debug("Error forwarding Azure messages: %s", e)

    async def _maybe_handle_profile_tool_call(
        self,
        event_dict: Dict[str, Any],
        azure_conn: VoiceLiveConnection,
        client_ws: simple_websocket.ws.Server,
        profile: AgentProfile,
        profile_context: AgentProfileContext,
        handled_tool_call_ids: set[str] | None = None,
    ) -> bool:
        tool_call = self._extract_profile_tool_call(event_dict)
        if tool_call is None:
            return False
        name, call_id, arguments = tool_call
        if profile.id == "learner_ask" and not str(arguments.get("question") or "").strip():
            # VoiceLive can emit incomplete argument snapshots before the final
            # function_call item is done. For learner_ask, wait until the
            # required question argument is present.
            return False
        if name not in profile.tool_handlers:
            return False
        if handled_tool_call_ids is not None:
            if call_id in handled_tool_call_ids:
                return True
            handled_tool_call_ids.add(call_id)

        try:
            result = dict(profile.handle_tool_call(name, arguments, profile_context))
        except Exception as exc:
            logger.exception("Voice profile tool call failed: %s", name)
            result = {"error": str(exc) or "Tool call failed"}

        output = json.dumps(result, separators=(",", ":"))
        await azure_conn.send(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                },
            }
        )
        card = result.get("card")
        if profile.id == "learner" and isinstance(card, dict):
            await self._send_message(
                client_ws,
                {
                    "type": "wulo.learner_card",
                    "payload": {
                        "card": card,
                        "session_complete": bool(result.get("session_complete", False)),
                    },
                },
            )
        elif profile.id == "learner_ask":
            blocks = result.get("blocks")
            if isinstance(blocks, list):
                session_complete = bool(result.get("session_complete", False))
                for block in self._screen_assistant_blocks(blocks):
                    await self._send_message(
                        client_ws,
                        {
                            "type": "wulo.assistant_block",
                            "payload": {
                                "block": block,
                                "session_complete": session_complete,
                            },
                        },
                    )
        return True

    @staticmethod
    def _screen_assistant_blocks(blocks: list[Any]) -> list[dict[str, Any]]:
        """Defense-in-depth outbound screen on gen-UI blocks before emission.

        ``run_assistant_turn`` already runs grounding + ``screen_outbound_text``
        on the prose it produces, but the card/block emission point historically
        forwarded planner output to the client unscreened. We re-screen the
        speakable/visible text of each block here and drop any block the
        safeguarding lexicon rejects, so a regression in the brain can never push
        unsafe text to a child's screen.
        """
        from src.learning.tutor import screen_outbound_text  # lazy: avoid import cycle

        screened: list[dict[str, Any]] = []
        for raw in blocks:
            if not isinstance(raw, dict):
                continue
            text_parts = [
                str(raw.get(key) or "")
                for key in ("speak", "text", "title", "body")
            ]
            combined = " ".join(part for part in text_parts if part).strip()
            if combined:
                try:
                    decision = screen_outbound_text(combined)
                except Exception:  # screening must never crash the turn
                    logger.exception("Outbound block screening failed")
                    continue
                if not getattr(decision, "allowed", True):
                    logger.warning("Dropped assistant block failing outbound screen")
                    continue
            screened.append(raw)
        return screened

    def _extract_profile_tool_call(self, event_dict: Dict[str, Any]) -> tuple[str, str, Dict[str, Any]] | None:
        event_type = str(event_dict.get("type") or "")
        if event_type == "response.function_call_arguments.done":
            name = str(event_dict.get("name") or "").strip()
            call_id = str(event_dict.get("call_id") or event_dict.get("item_id") or "").strip()
            arguments = self._coerce_tool_arguments(event_dict.get("arguments"))
            if name and call_id:
                return name, call_id, arguments

        if event_type == "response.output_item.done":
            item = event_dict.get("item")
            if isinstance(item, dict) and str(item.get("type") or "") == "function_call":
                name = str(item.get("name") or "").strip()
                call_id = str(item.get("call_id") or item.get("id") or "").strip()
                arguments = self._coerce_tool_arguments(item.get("arguments"))
                if name and call_id:
                    return name, call_id, arguments

        if event_type == "conversation.item.created":
            item = event_dict.get("item")
            if isinstance(item, dict) and str(item.get("type") or "") == "function_call":
                name = str(item.get("name") or "").strip()
                call_id = str(item.get("call_id") or item.get("id") or "").strip()
                arguments = self._coerce_tool_arguments(item.get("arguments"))
                if name and call_id:
                    return name, call_id, arguments
        return None

    def _coerce_tool_arguments(self, raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return dict(raw)
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return {}
            return dict(parsed) if isinstance(parsed, dict) else {}
        return {}

    def _normalize_outbound_text_fields(self, parsed: Any) -> None:
        """Rewrite graphemic phoneme citations in text fields forwarded to Azure.

        Voice Live renders any text we hand it via its TTS. When we forward a
        ``session.update`` with ``instructions`` or a ``conversation.item.create``
        carrying literal text, raw ``/th/``/``/sh/`` strings would be voiced as
        letter names. We wrap them in SSML ``<phoneme>`` before they leave the
        proxy. Non-text control frames are left untouched.
        """
        if not isinstance(parsed, dict):
            return

        event_type = str(parsed.get("type") or "")

        if event_type == "session.update":
            session = parsed.get("session")
            if isinstance(session, dict):
                instructions = session.get("instructions")
                if isinstance(instructions, str) and instructions:
                    session["instructions"] = normalize_for_tts(instructions)

        elif event_type == "conversation.item.create":
            item = parsed.get("item")
            if isinstance(item, dict):
                content = item.get("content")
                if isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict):
                            continue
                        for key in ("text", "input_text"):
                            value = part.get(key)
                            if isinstance(value, str) and value:
                                part[key] = normalize_for_tts(value)

        elif event_type == "response.create":
            response = parsed.get("response")
            if isinstance(response, dict):
                instructions = response.get("instructions")
                if isinstance(instructions, str) and instructions:
                    response["instructions"] = normalize_for_tts(instructions)

    def _apply_profile_response_tool_choice(self, parsed: Any, profile: AgentProfile | None) -> None:
        if not isinstance(parsed, dict) or profile is None or not profile.forced_response_tool_name:
            return
        if str(parsed.get("type") or "") != "response.create":
            return
        response = parsed.setdefault("response", {})
        if not isinstance(response, dict) or response.get("tool_choice"):
            return
        response["tool_choice"] = {
            "type": "function",
            "name": profile.forced_response_tool_name,
        }

    def _build_profile_tool_response_create(self, profile: AgentProfile | None) -> Dict[str, Any]:
        message: Dict[str, Any] = {"type": "response.create"}
        if profile is not None and profile.id == "learner":
            message["response"] = {
                "instructions": (
                    "Use the get_next_card tool output from the previous item. "
                    "It is JSON with a card object. If card.speak is present, "
                    "read that aloud naturally. If card.speak is missing, read "
                    "the card prompt or stem and options. Do not mention JSON, "
                    "schemas, tool output, or wrong format to the learner unless "
                    "the tool output contains an explicit error field."
                )
            }
        return message

    async def _send_message(self, ws: simple_websocket.ws.Server, message: Dict[str, Any]) -> None:
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
