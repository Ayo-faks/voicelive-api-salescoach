# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Flask application for the Wulo agent."""

import asyncio
import base64
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Mapping, Optional, Tuple, cast

import simple_websocket.ws  # pyright: ignore[reportMissingTypeStubs]
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_sock import Sock  # pyright: ignore[reportMissingTypeStubs]

from src.config import config
from src.services.analyzers import ConversationAnalyzer, PronunciationAssessor
from src.services.managers import AgentManager, ScenarioManager
from src.services.planning_service import PracticePlanningService
from src.services.storage_factory import create_storage_service
from src.services.telemetry import PilotTelemetryService
from src.services.websocket_handler import VoiceProxyHandler

# Constants
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = Path(__file__).resolve().parents[2]
STATIC_FOLDER = str(BACKEND_DIR / "static")


def resolve_image_data_folder() -> str:
    """Resolve image assets correctly both from source checkout and container image."""
    candidate_paths = [
        REPO_DIR / "data" / "images",
        BACKEND_DIR / "data" / "images",
    ]

    for candidate in candidate_paths:
        if candidate.exists():
            return str(candidate)

    return str(candidate_paths[0])


IMAGE_DATA_FOLDER = resolve_image_data_folder()
STATIC_URL_PATH = ""
INDEX_FILE = "index.html"
AUDIO_PROCESSOR_FILE = "audio-processor.js"
WEBSOCKET_ENDPOINT = "/ws/voice"

# API endpoints
API_CONFIG_ENDPOINT = "/api/config"
API_HEALTH_ENDPOINT = "/api/health"
API_SCENARIOS_ENDPOINT = "/api/scenarios"
API_AUTH_SESSION_ENDPOINT = "/api/auth/session"
API_PILOT_STATE_ENDPOINT = "/api/pilot/state"
API_CONSENT_ENDPOINT = "/api/pilot/consent"
API_AGENTS_CREATE_ENDPOINT = "/api/agents/create"
API_ANALYZE_ENDPOINT = "/api/analyze"
API_ASSESS_UTTERANCE_ENDPOINT = "/api/assess-utterance"
API_TTS_ENDPOINT = "/api/tts"
API_CHILDREN_ENDPOINT = "/api/children"
API_CHILD_SESSIONS_ENDPOINT = "/api/children/<child_id>/sessions"
API_CHILD_PLANS_ENDPOINT = "/api/children/<child_id>/plans"
API_SESSION_DETAIL_ENDPOINT = "/api/sessions/<session_id>"
API_SESSION_FEEDBACK_ENDPOINT = "/api/sessions/<session_id>/feedback"
API_PLANS_ENDPOINT = "/api/plans"
API_PLAN_DETAIL_ENDPOINT = "/api/plans/<plan_id>"
API_PLAN_MESSAGES_ENDPOINT = "/api/plans/<plan_id>/messages"
API_PLAN_APPROVE_ENDPOINT = "/api/plans/<plan_id>/approve"
API_USER_ROLE_ENDPOINT = "/api/users/<user_id>/role"
API_IMAGES_ENDPOINT = "/api/images/<path:image_path>"

# Error messages
SCENARIO_ID_REQUIRED = "scenario_id is required"
SCENARIO_NOT_FOUND = "Scenario not found"
TRANSCRIPT_REQUIRED = "scenario_id and transcript are required"
UTTERANCE_REQUIRED = "utterance and reference_text are required"
AUTH_REQUIRED = "Authentication required"
THERAPIST_ROLE_REQUIRED = "Therapist role required"
SESSION_NOT_FOUND = "Session not found"
USER_NOT_FOUND = "User not found"
INVALID_ROLE = "Role must be 'therapist' or 'user'"
INVALID_FEEDBACK_RATING = "Feedback rating must be 'up' or 'down'"
PLAN_NOT_FOUND = "Practice plan not found"
PLAN_MESSAGE_REQUIRED = "message is required"
PLANNER_SERVICE_UNAVAILABLE = "Planner service unavailable"

# HTTP status codes
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_UNAUTHORIZED = 401
HTTP_INTERNAL_SERVER_ERROR = 500

ROLE_THERAPIST = "therapist"
ROLE_USER = "user"
LOCAL_DEV_AUTH = bool(config["local_dev_auth"])


def _is_azure_hosted_environment() -> bool:
    """Detect Azure-hosted runtime markers so LOCAL_DEV_AUTH fails closed in production."""
    azure_runtime_markers = (
        "CONTAINER_APP_NAME",
        "CONTAINER_APP_REVISION",
        "CONTAINER_APP_ENV_DNS_SUFFIX",
        "WEBSITE_SITE_NAME",
        "WEBSITE_HOSTNAME",
        "IDENTITY_ENDPOINT",
    )
    return any(str(os.environ.get(marker, "")).strip() for marker in azure_runtime_markers)


if LOCAL_DEV_AUTH and _is_azure_hosted_environment():
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in Azure-hosted environments.")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path=STATIC_URL_PATH)
sock = Sock(app)

# Initialize managers and analyzers
scenario_manager = ScenarioManager()
agent_manager = AgentManager()
conversation_analyzer = ConversationAnalyzer()
pronunciation_assessor = PronunciationAssessor()
voice_proxy_handler = VoiceProxyHandler(agent_manager)
telemetry_service = PilotTelemetryService(config["applicationinsights_connection_string"])
storage_service = None
planning_service = None
planner_startup_readiness: Dict[str, Any] = {}


def initialize_runtime_services() -> None:
    """Initialize storage-backed services for the application runtime."""
    global storage_service
    global planning_service
    global planner_startup_readiness

    storage_service = create_storage_service(config.as_dict)
    planning_service = PracticePlanningService(storage_service, scenario_manager)
    planner_startup_readiness = planning_service.get_readiness(force_refresh=True)
    if not planner_startup_readiness.get("ready"):
        logger.warning("Planner readiness check failed at startup: %s", planner_startup_readiness)


initialize_runtime_services()


def _normalize_utterance_audio(utterance_payload: Any) -> List[Dict[str, Any]]:
    """Normalize a single utterance payload into the audio chunk list expected by the assessor."""
    if isinstance(utterance_payload, list):
        return [chunk for chunk in utterance_payload if isinstance(chunk, dict)]

    if isinstance(utterance_payload, dict):
        audio_data = utterance_payload.get("audio_data")
        if isinstance(audio_data, list):
            return [chunk for chunk in audio_data if isinstance(chunk, dict)]

        if utterance_payload.get("type") and utterance_payload.get("data"):
            return [cast(Dict[str, Any], utterance_payload)]

    return []


def _build_custom_exercise_context(custom_scenario: Dict[str, Any]) -> str:
    """Build extra instructions for therapist-authored exercises."""
    exercise_metadata = cast(Dict[str, Any], custom_scenario.get("exercise_metadata") or {})
    target_words = exercise_metadata.get("target_words") or []
    formatted_words = ", ".join(str(word) for word in target_words if str(word).strip())
    exercise_type = exercise_metadata.get("exercise_type", "guided_prompt")
    target_sound = exercise_metadata.get("target_sound", "")
    difficulty = exercise_metadata.get("difficulty", "")
    prompt_text = exercise_metadata.get("prompt_text", "")

    instructions = [
        "CUSTOM EXERCISE DETAILS:",
        f"- Exercise name: {custom_scenario.get('name', 'Custom exercise')}",
        f"- Exercise description: {custom_scenario.get('description', '')}",
        f"- Exercise type: {exercise_type}",
    ]

    if target_sound:
        instructions.append(f"- Target sound: {target_sound}")
    if formatted_words:
        instructions.append(f"- Target words: {formatted_words}")
    if difficulty:
        instructions.append(f"- Difficulty: {difficulty}")
    if prompt_text:
        instructions.append(f"- Child-facing prompt: {prompt_text}")

    instructions.extend(
        [
            "- Keep the child focused on this exercise and repeat the target prompt when helpful.",
            "- Encourage retries with warm, simple language.",
        ]
    )

    return "\n".join(instructions)


def _normalize_telemetry_value(value: Any) -> Optional[str]:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _extract_exercise_telemetry_properties(
    scenario_id: str,
    exercise_metadata: Optional[Dict[str, Any]] = None,
    exercise_context: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    metadata = exercise_metadata or {}
    context = exercise_context or {}

    return {
        "scenario_id": scenario_id,
        "session_id": session_id,
        "exercise_type": _normalize_telemetry_value(
            metadata.get("type") or metadata.get("exercise_type")
        ),
        "difficulty": _normalize_telemetry_value(metadata.get("difficulty")),
        "is_custom": bool(context.get("is_custom")),
    }


def _parse_timestamp(timestamp: Any) -> Optional[datetime]:
    if timestamp is None:
        return None

    if isinstance(timestamp, (int, float)):
        return datetime.fromtimestamp(float(timestamp) / 1000, tz=timezone.utc)

    if not isinstance(timestamp, str):
        return None

    normalized = timestamp.strip()
    if not normalized:
        return None

    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _calculate_session_duration_seconds(started_at: Any) -> Optional[float]:
    started = _parse_timestamp(started_at)
    if started is None:
        return None

    duration = (datetime.now(timezone.utc) - started).total_seconds()
    if duration < 0:
        return None

    return round(duration, 2)


def _get_default_child() -> Tuple[str, str]:
    children = storage_service.list_children()
    if children:
        first_child = children[0]
        return str(first_child["id"]), str(first_child["name"])

    child_id = str(config["default_child_id"])
    return child_id, child_id.replace("-", " ").title()


def _normalize_exercise_context(
    scenario_id: str,
    exercise_context: Optional[Dict[str, Any]],
    exercise_metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if exercise_context:
        context = dict(exercise_context)
        context["id"] = context.get("id") or scenario_id
        context["name"] = context.get("name") or scenario_id.replace("-", " ").title()
        context["description"] = context.get("description") or ""
        context["exerciseMetadata"] = context.get("exerciseMetadata") or exercise_metadata or {}
        return context

    scenario = scenario_manager.get_scenario(scenario_id) or {}
    return {
        "id": scenario_id,
        "name": scenario.get("name", scenario_id.replace("-", " ").title()),
        "description": scenario.get("description", ""),
        "exerciseMetadata": exercise_metadata or scenario.get("exerciseMetadata", {}),
        "is_custom": bool(scenario.get("is_custom")),
    }


def _save_completed_session(
    scenario_id: str,
    analysis_result: Dict[str, Any],
    transcript: str,
    reference_text: str,
    exercise_metadata: Optional[Dict[str, Any]],
    child_id: Optional[str],
    child_name: Optional[str],
    exercise_context: Optional[Dict[str, Any]],
) -> Optional[str]:
    if not analysis_result.get("ai_assessment") and not analysis_result.get("pronunciation_assessment"):
        return None

    default_child_id, default_child_name = _get_default_child()
    session = storage_service.save_session(
        {
            "child_id": child_id or default_child_id,
            "child_name": child_name or default_child_name,
            "exercise": _normalize_exercise_context(scenario_id, exercise_context, exercise_metadata),
            "exercise_metadata": exercise_metadata or {},
            "ai_assessment": analysis_result.get("ai_assessment"),
            "pronunciation_assessment": analysis_result.get("pronunciation_assessment"),
            "transcript": transcript,
            "reference_text": reference_text,
        }
    )
    return cast(str, session.get("id"))


def _normalize_context_value(value: Any) -> str:
    if value is None:
        return ""

    text = str(value).strip()
    return text


def _decode_client_principal(principal_header: str) -> Dict[str, Any]:
    try:
        padding = "=" * (-len(principal_header) % 4)
        decoded = base64.b64decode(f"{principal_header}{padding}").decode("utf-8")
        payload = json.loads(decoded)
        return cast(Dict[str, Any], payload)
    except (ValueError, json.JSONDecodeError):
        logger.warning("Failed to decode X-MS-CLIENT-PRINCIPAL header")
        return {}


def _extract_principal_claims(principal: Dict[str, Any]) -> Dict[str, str]:
    claims: Dict[str, str] = {}

    for claim in cast(List[Dict[str, Any]], principal.get("claims") or []):
        claim_type = _normalize_context_value(claim.get("typ"))
        claim_value = _normalize_context_value(claim.get("val"))
        if not claim_type or not claim_value:
            continue

        claims[claim_type.split("/")[-1]] = claim_value

    return claims


def _normalize_identity_provider(provider: Any) -> str:
    normalized = _normalize_context_value(provider).lower()
    if not normalized:
        return "unknown"

    return normalized


def _get_authenticated_user_from_headers(headers: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    principal_header = _normalize_context_value(headers.get("X-MS-CLIENT-PRINCIPAL"))
    principal = _decode_client_principal(principal_header) if principal_header else {}
    claims = _extract_principal_claims(principal)

    user_id = (
        _normalize_context_value(headers.get("X-MS-CLIENT-PRINCIPAL-ID"))
        or _normalize_context_value(principal.get("userId"))
        or claims.get("sub", "")
        or claims.get("nameidentifier", "")
    )
    if user_id:
        name = (
            _normalize_context_value(headers.get("X-MS-CLIENT-PRINCIPAL-NAME"))
            or claims.get("name", "")
            or claims.get("preferred_username", "")
            or _normalize_context_value(principal.get("userDetails"))
            or "Authenticated User"
        )
        email = (
            _normalize_context_value(headers.get("X-MS-CLIENT-PRINCIPAL-EMAIL"))
            or _normalize_context_value(principal.get("userDetails"))
            or claims.get("emailaddress", "")
            or claims.get("email", "")
            or claims.get("preferred_username", "")
        )
        provider = _normalize_identity_provider(
            _normalize_context_value(headers.get("X-MS-CLIENT-PRINCIPAL-IDP"))
            or _normalize_context_value(principal.get("auth_typ"))
            or _normalize_context_value(principal.get("identityProvider"))
        )
        return storage_service.get_or_create_user(user_id, email, name, provider)

    if LOCAL_DEV_AUTH:
        user_id = os.environ.get("LOCAL_DEV_USER_ID", "local-dev-user")
        name = os.environ.get("LOCAL_DEV_USER_NAME", "Local Developer")
        email = os.environ.get("LOCAL_DEV_USER_EMAIL", "dev@localhost")
        provider = _normalize_identity_provider(os.environ.get("LOCAL_DEV_USER_PROVIDER", "local-dev"))
        return storage_service.get_or_create_user(user_id, email, name, provider)

    return None


def _get_authenticated_user() -> Optional[Dict[str, Any]]:
    return _get_authenticated_user_from_headers(request.headers)


def _require_authenticated() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user = _get_authenticated_user()
    if user is None:
        return None, (jsonify({"error": AUTH_REQUIRED}), HTTP_UNAUTHORIZED)

    return user, None


def _require_therapist() -> Optional[Tuple[Any, int]]:
    _, guard_response = _require_therapist_user()
    return guard_response


def _require_therapist_user() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return None, guard_response

    if user is None or user.get("role") != ROLE_THERAPIST:
        return None, (jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN)

    return user, None


def _prepare_custom_scenario(custom_scenario: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize and enrich a custom exercise payload before agent creation."""
    scenario = dict(custom_scenario)
    messages = list(cast(List[Dict[str, Any]], scenario.get("messages") or []))
    exercise_context = _build_custom_exercise_context(scenario)

    if messages and messages[0].get("role") == "system":
        messages[0] = {
            **messages[0],
            "content": f"{messages[0].get('content', '').rstrip()}\n\n{exercise_context}",
        }
    else:
        messages.insert(0, {"role": "system", "content": exercise_context})

    scenario["messages"] = messages
    return scenario


def _serve_index() -> Any:
    """Serve the SPA entry point for browser routes."""
    if app.static_folder is None:
        logger.error("STATIC_FOLDER is not set. Cannot serve index.html.")
        import sys  # pylint: disable=C0415

        sys.exit(1)

    return send_from_directory(app.static_folder, INDEX_FILE)


def _should_serve_spa_route(path: str) -> bool:
    """Return True when the path should fall back to the frontend SPA."""
    normalized_path = path.lstrip("/")

    if normalized_path.startswith("api/") or normalized_path.startswith(".auth/"):
        return False

    if normalized_path == AUDIO_PROCESSOR_FILE:
        return False

    return "." not in Path(normalized_path).name


@app.route("/")
@app.route("/logout")
def index():
    """Serve the main application page."""
    return _serve_index()


@app.errorhandler(404)
def spa_fallback(error: Any):
    """Serve index.html for SPA deep links after static and API routes miss."""
    if _should_serve_spa_route(request.path):
        return _serve_index(), 200

    return error


@app.route(API_CONFIG_ENDPOINT)
def get_config():
    """Get client configuration."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    return jsonify(
        {
            "status": "ok",
            "proxy_enabled": True,
            "ws_endpoint": WEBSOCKET_ENDPOINT,
            "storage_ready": True,
            "telemetry_enabled": telemetry_service.enabled,
            "image_base_path": "/api/images",
            "planner": planning_service.get_readiness(),
        }
    )


@app.route(API_HEALTH_ENDPOINT)
def health():
    """Return a minimal health payload for ingress and auth exclusions."""
    return jsonify({"status": "ok"})


@app.route(API_AUTH_SESSION_ENDPOINT)
def get_auth_session():
    """Return the authenticated user session derived from Easy Auth headers."""
    user = _get_authenticated_user()
    if user is None:
        return jsonify({"authenticated": False}), HTTP_UNAUTHORIZED

    return jsonify(
        {
            "authenticated": True,
            "user_id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "provider": user["provider"],
            "role": user["role"],
        }
    )


@app.route(API_PILOT_STATE_ENDPOINT)
def get_pilot_state():
    """Return minimal onboarding and consent state for Sprint 6 pilot flow."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    return jsonify(storage_service.get_pilot_state())


@app.route(API_CONSENT_ENDPOINT, methods=["POST"])
def acknowledge_consent():
    """Persist therapist acknowledgement for supervised practice consent."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    consent_timestamp = storage_service.save_consent_acknowledgement()
    return jsonify({"consent_timestamp": consent_timestamp})


@app.route(API_SCENARIOS_ENDPOINT)
def get_scenarios():
    """Get list of available scenarios."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    return jsonify(scenario_manager.list_scenarios())


@app.route(f"{API_SCENARIOS_ENDPOINT}/<scenario_id>")
def get_scenario(scenario_id: str):
    """Get a specific scenario by ID."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    scenario = scenario_manager.get_scenario(scenario_id)
    if scenario:
        return jsonify(scenario)
    return jsonify({"error": SCENARIO_NOT_FOUND}), HTTP_NOT_FOUND


@app.route(API_CHILDREN_ENDPOINT)
def get_children():
    """Return the available child profiles for therapist-guided sessions."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    return jsonify(storage_service.list_children())


@app.route(API_AGENTS_CREATE_ENDPOINT, methods=["POST"])
def create_agent():
    """Create a new agent for a scenario.

    Supports two modes:
    1. Server-side scenario: Pass scenario_id to use a pre-defined scenario
    2. Custom scenario: Pass custom_scenario with full scenario data (for client-side scenarios)
    """
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    scenario_id = data.get("scenario_id")
    custom_scenario = data.get("custom_scenario")
    avatar_config = data.get("avatar")

    # Support custom scenarios passed directly from the client
    if custom_scenario:
        scenario = _prepare_custom_scenario(cast(Dict[str, Any], custom_scenario))
        scenario_id = custom_scenario.get("id", f"custom-{int(time.time())}")
        logger.info("Creating agent with custom scenario: %s", scenario_id)
    else:
        if not scenario_id:
            return jsonify({"error": SCENARIO_ID_REQUIRED}), HTTP_BAD_REQUEST

        scenario = scenario_manager.get_scenario(scenario_id)
        if not scenario:
            logger.error(
                "Scenario not found: %s. Available scenarios: %s + generated: %s",
                scenario_id,
                list(scenario_manager.scenarios.keys()),
                list(scenario_manager.generated_scenarios.keys()),
            )
            return jsonify({"error": SCENARIO_NOT_FOUND}), HTTP_NOT_FOUND

    try:
        agent_id = agent_manager.create_agent(scenario_id, scenario, avatar_config)

        exercise_context = (
            {
                "is_custom": True,
            }
            if custom_scenario
            else cast(Dict[str, Any], scenario or {})
        )
        exercise_metadata = cast(
            Optional[Dict[str, Any]],
            (custom_scenario or {}).get("exercise_metadata") or (scenario or {}).get("exerciseMetadata"),
        )
        telemetry_service.track_event(
            "exercise_started",
            properties=_extract_exercise_telemetry_properties(
                str(scenario_id),
                exercise_metadata,
                exercise_context,
            ),
        )
        return jsonify({"agent_id": agent_id, "scenario_id": scenario_id})
    except Exception as e:
        logger.error("Failed to create agent: %s", e)
        return jsonify({"error": str(e)}), HTTP_INTERNAL_SERVER_ERROR


@app.route("/api/agents/<agent_id>", methods=["DELETE"])
def delete_agent(agent_id: str):
    """Delete an agent."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        agent_manager.delete_agent(agent_id)
        return jsonify({"success": True})
    except Exception as e:
        logger.error("Failed to delete agent: %s", e)
        return jsonify({"error": str(e)}), HTTP_INTERNAL_SERVER_ERROR


@app.route(API_ANALYZE_ENDPOINT, methods=["POST"])
def analyze_conversation():
    """Analyze a conversation for performance assessment."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    scenario_id = cast(str, data.get("scenario_id"))
    transcript = cast(str, data.get("transcript"))
    audio_data = data.get("audio_data", [])
    reference_text = cast(str, data.get("reference_text"))
    exercise_metadata = cast(Optional[Dict[str, Any]], data.get("exercise_metadata") or None)
    child_id = cast(Optional[str], data.get("child_id") or None)
    child_name = cast(Optional[str], data.get("child_name") or None)
    exercise_context = cast(Optional[Dict[str, Any]], data.get("exercise_context") or None)
    session_started_at = data.get("session_started_at")

    _log_analyze_request(scenario_id, transcript, reference_text)

    if not scenario_id or not transcript:
        return jsonify({"error": TRANSCRIPT_REQUIRED}), HTTP_BAD_REQUEST

    analysis_result = _perform_conversation_analysis(
        scenario_id,
        transcript,
        audio_data,
        reference_text,
        exercise_metadata,
    )

    session_id = _save_completed_session(
        scenario_id,
        analysis_result,
        transcript,
        reference_text,
        exercise_metadata,
        child_id,
        child_name,
        exercise_context,
    )
    if session_id:
        analysis_result["session_id"] = session_id

    base_properties = _extract_exercise_telemetry_properties(
        scenario_id,
        exercise_metadata,
        exercise_context,
        session_id,
    )
    measurements: Dict[str, float] = {}
    if analysis_result.get("ai_assessment"):
        measurements["overall_score"] = float(
            cast(Dict[str, Any], analysis_result["ai_assessment"]).get("overall_score", 0)
        )
    if analysis_result.get("pronunciation_assessment"):
        pronunciation = cast(Dict[str, Any], analysis_result["pronunciation_assessment"])
        measurements["pronunciation_score"] = float(pronunciation.get("pronunciation_score", 0))
        measurements["accuracy_score"] = float(pronunciation.get("accuracy_score", 0))

    telemetry_service.track_event("exercise_completed", properties=base_properties, measurements=measurements)

    duration_seconds = _calculate_session_duration_seconds(session_started_at)
    if duration_seconds is not None:
        telemetry_service.track_event(
            "session_duration",
            properties={"scenario_id": scenario_id, "session_id": session_id},
            measurements={"duration_seconds": duration_seconds},
        )

    return jsonify(analysis_result)


@app.route(API_ASSESS_UTTERANCE_ENDPOINT, methods=["POST"])
def assess_utterance():
    """Assess a single recorded utterance and return immediate pronunciation feedback."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    scenario_id = cast(str, data.get("scenario_id") or "")
    reference_text = cast(str, data.get("reference_text") or "")
    exercise_metadata = cast(Optional[Dict[str, Any]], data.get("exercise_metadata") or None)
    utterance_audio = _normalize_utterance_audio(data.get("utterance") or data.get("audio_data"))

    if not utterance_audio or not reference_text:
        return jsonify({"error": UTTERANCE_REQUIRED}), HTTP_BAD_REQUEST

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        pronunciation = loop.run_until_complete(
            pronunciation_assessor.assess_pronunciation(
                utterance_audio,
                reference_text,
                exercise_metadata,
            )
        )
        if pronunciation:
            telemetry_service.track_event(
                "utterance_scored",
                properties=_extract_exercise_telemetry_properties(
                    scenario_id or "unknown-exercise",
                    exercise_metadata,
                ),
                measurements={
                    "accuracy_score": float(pronunciation.get("accuracy_score", 0)),
                    "pronunciation_score": float(pronunciation.get("pronunciation_score", 0)),
                    "word_count": float(len(pronunciation.get("words") or [])),
                },
            )
        return jsonify({"pronunciation_assessment": pronunciation})
    finally:
        loop.close()


@app.route(API_TTS_ENDPOINT, methods=["POST"])
def synthesize_speech():
    """Synthesize a short text string using Azure AI Speech and return WAV audio."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    text = cast(str, data.get("text") or "").strip()
    if not text or len(text) > 200:
        return jsonify({"error": "text is required (max 200 chars)"}), HTTP_BAD_REQUEST

    voice_name = config["azure_voice_name"]
    speech_key = config["azure_speech_key"]
    speech_region = config["azure_speech_region"]

    if not speech_key:
        return jsonify({"error": "Speech service not configured"}), HTTP_INTERNAL_SERVER_ERROR

    try:
        import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]

        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        speech_config.speech_synthesis_voice_name = voice_name
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3
        )
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        result = synthesizer.speak_text_async(text).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            audio_b64 = base64.b64encode(result.audio_data).decode("ascii")
            return jsonify({"audio": audio_b64, "format": "mp3"})
        else:
            logger.error("TTS synthesis failed: %s", result.reason)
            return jsonify({"error": "Speech synthesis failed"}), HTTP_INTERNAL_SERVER_ERROR
    except Exception:
        logger.exception("TTS endpoint error")
        return jsonify({"error": "Speech synthesis error"}), HTTP_INTERNAL_SERVER_ERROR


@app.route(API_CHILD_SESSIONS_ENDPOINT)
def get_child_sessions(child_id: str):
    """Return a therapist-friendly session history for one child."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    return jsonify(storage_service.list_sessions_for_child(child_id))


@app.route(API_CHILD_PLANS_ENDPOINT)
def get_child_plans(child_id: str):
    """Return saved practice plans for one child."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    return jsonify(storage_service.list_practice_plans_for_child(child_id))


@app.route(API_PLANS_ENDPOINT, methods=["POST"])
def create_practice_plan():
    """Create a therapist-facing practice plan from a saved session."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    child_id = str(data.get("child_id") or "").strip()
    source_session_id = str(data.get("source_session_id") or "").strip()
    therapist_message = str(data.get("message") or "").strip()

    if not child_id or not source_session_id:
        return jsonify({"error": "child_id and source_session_id are required"}), HTTP_BAD_REQUEST

    try:
        plan = planning_service.create_plan(
            child_id=child_id,
            source_session_id=source_session_id,
            created_by_user_id=str(cast(Dict[str, Any], user).get("id")),
            therapist_message=therapist_message,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_NOT_FOUND
    except RuntimeError as error:
        logger.exception("Planner create error")
        return jsonify({"error": str(error) or PLANNER_SERVICE_UNAVAILABLE}), HTTP_INTERNAL_SERVER_ERROR

    telemetry_service.track_event(
        "planner_plan_created",
        properties={
            "child_id": child_id,
            "source_session_id": source_session_id,
            "plan_id": plan["id"],
        },
    )
    return jsonify(plan)


@app.route(API_PLAN_DETAIL_ENDPOINT)
def get_practice_plan(plan_id: str):
    """Return a single practice plan."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    plan = storage_service.get_practice_plan(plan_id)
    if plan is None:
        return jsonify({"error": PLAN_NOT_FOUND}), HTTP_NOT_FOUND

    return jsonify(plan)


@app.route(API_PLAN_MESSAGES_ENDPOINT, methods=["POST"])
def refine_practice_plan(plan_id: str):
    """Refine an existing practice plan using a therapist instruction."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    therapist_message = str(data.get("message") or "").strip()
    if not therapist_message:
        return jsonify({"error": PLAN_MESSAGE_REQUIRED}), HTTP_BAD_REQUEST

    try:
        plan = planning_service.refine_plan(plan_id, therapist_message)
    except ValueError as error:
        status_code = HTTP_NOT_FOUND if "not found" in str(error).lower() else HTTP_BAD_REQUEST
        return jsonify({"error": str(error)}), status_code
    except RuntimeError as error:
        logger.exception("Planner refine error")
        return jsonify({"error": str(error) or PLANNER_SERVICE_UNAVAILABLE}), HTTP_INTERNAL_SERVER_ERROR

    telemetry_service.track_event(
        "planner_plan_refined",
        properties={"plan_id": plan_id},
    )
    return jsonify(plan)


@app.route(API_PLAN_APPROVE_ENDPOINT, methods=["POST"])
def approve_practice_plan(plan_id: str):
    """Approve a practice plan for therapist use."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    plan = storage_service.approve_practice_plan(plan_id)
    if plan is None:
        return jsonify({"error": PLAN_NOT_FOUND}), HTTP_NOT_FOUND

    telemetry_service.track_event(
        "planner_plan_approved",
        properties={"plan_id": plan_id, "child_id": plan["child_id"]},
    )
    return jsonify(plan)


@app.route(API_SESSION_DETAIL_ENDPOINT)
def get_session_detail(session_id: str):
    """Return the full saved session detail for therapist review."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    session = storage_service.get_session(session_id)
    if session is None:
        return jsonify({"error": SESSION_NOT_FOUND}), HTTP_NOT_FOUND

    telemetry_service.track_event(
        "therapist_review_opened",
        properties={
            "session_id": session_id,
            "exercise_id": cast(Dict[str, Any], session.get("exercise") or {}).get("id"),
        },
    )

    return jsonify(session)


@app.route(API_SESSION_FEEDBACK_ENDPOINT, methods=["POST"])
def save_session_feedback(session_id: str):
    """Store lightweight therapist feedback for a completed session."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    rating = str(data.get("rating") or "").strip().lower()
    note = cast(Optional[str], data.get("note") or None)

    if rating not in {"up", "down"}:
        return jsonify({"error": INVALID_FEEDBACK_RATING}), HTTP_BAD_REQUEST

    session = storage_service.save_session_feedback(session_id, rating, note)
    if session is None:
        return jsonify({"error": SESSION_NOT_FOUND}), HTTP_NOT_FOUND

    return jsonify(session)


@app.route(API_USER_ROLE_ENDPOINT, methods=["POST"])
def update_user_role(user_id: str):
    """Promote or demote a user role. Therapist access only."""
    guard_response = _require_therapist()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    role = str(data.get("role") or "").strip().lower()
    if role not in {ROLE_THERAPIST, ROLE_USER}:
        return jsonify({"error": INVALID_ROLE}), HTTP_BAD_REQUEST

    try:
        user = storage_service.update_user_role(user_id, role)
    except ValueError:
        return jsonify({"error": INVALID_ROLE}), HTTP_BAD_REQUEST

    if user is None:
        return jsonify({"error": USER_NOT_FOUND}), HTTP_NOT_FOUND

    return jsonify(user)


def _log_analyze_request(scenario_id: str, transcript: str, reference_text: str):
    """Log information about the analyze request."""
    logger.info(
        "Analyze request - scenario: %s, transcript length: %s, reference_text length: %s",
        scenario_id,
        len(transcript or ""),
        len(reference_text or ""),
    )


def _perform_conversation_analysis(
    scenario_id: str,
    transcript: str,
    audio_data: List[Dict[str, Any]],
    reference_text: str,
    exercise_metadata: Optional[Dict[str, Any]] = None,
):
    """Perform the actual conversation analysis."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        tasks = [
            conversation_analyzer.analyze_conversation(scenario_id, transcript),
            pronunciation_assessor.assess_pronunciation(audio_data, reference_text, exercise_metadata),
        ]

        results = loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))

        ai_assessment, pronunciation = results

        if isinstance(ai_assessment, Exception):
            logger.error("AI assessment failed: %s", ai_assessment)
            ai_assessment = None

        if isinstance(pronunciation, Exception):
            logger.error("Pronunciation assessment failed: %s", pronunciation)
            pronunciation = None

        return {"ai_assessment": ai_assessment, "pronunciation_assessment": pronunciation}

    finally:
        loop.close()


@app.route(f"/{AUDIO_PROCESSOR_FILE}")
def audio_processor():
    """Serve the audio processor JavaScript file."""
    return send_from_directory("static", AUDIO_PROCESSOR_FILE)


@app.route(API_IMAGES_ENDPOINT)
def image_asset(image_path: str):
    """Serve pre-generated therapy image assets."""
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    return send_from_directory(IMAGE_DATA_FOLDER, image_path)


@sock.route(WEBSOCKET_ENDPOINT)  # pyright: ignore[reportUnknownMemberType]
def voice_proxy(ws: simple_websocket.ws.Server):
    """WebSocket endpoint for voice proxy."""

    logger.info("New WebSocket connection")

    environ = cast(Dict[str, Any], getattr(ws, "environ", {}) or {})
    ws_headers = {
        "X-MS-CLIENT-PRINCIPAL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL", ""),
        "X-MS-CLIENT-PRINCIPAL-ID": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_ID", ""),
        "X-MS-CLIENT-PRINCIPAL-NAME": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_NAME", ""),
        "X-MS-CLIENT-PRINCIPAL-IDP": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_IDP", ""),
        "X-MS-CLIENT-PRINCIPAL-EMAIL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_EMAIL", ""),
    }

    if _get_authenticated_user_from_headers(ws_headers) is None:
        logger.warning("Rejected unauthenticated WebSocket connection")
        ws.close()
        return

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    loop.run_until_complete(voice_proxy_handler.handle_connection(ws))


def main():
    """Run the Flask application."""
    host = config["host"]
    port = config["port"]
    print(f"Starting Voice Live Demo on http://{host}:{port}")

    debug_mode = os.getenv("FLASK_ENV") == "development"
    app.run(host=host, port=port, debug=debug_mode)


if __name__ == "__main__":
    main()
