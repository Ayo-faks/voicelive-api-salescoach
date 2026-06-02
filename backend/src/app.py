# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Flask application for the Wulo agent."""

import asyncio
import base64
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading
import time
import uuid
from typing import Any, Dict, List, Mapping, Optional, Tuple, cast
from urllib.parse import parse_qs, urlsplit

import simple_websocket.ws  # pyright: ignore[reportMissingTypeStubs]
from flask import Flask, Response, g, jsonify, request, send_from_directory, stream_with_context
from flask_sock import Sock  # pyright: ignore[reportMissingTypeStubs]

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import config
from src.services.analyzers import ConversationAnalyzer, PronunciationAssessor
from src.services.child_memory_service import ChildMemoryService
from src.services.email_service import AzureCommunicationEmailService, InvitationEmailDeliveryResult
from src.services.institutional_memory_service import InstitutionalMemoryService
from src.learning.api import (
    LearningApi,
    PILOT_CLASS_ID,
    PILOT_STUDENT_ID,
    PILOT_TENANT_ID,
    register_learning_api,
)
from src.learning.errors import LearningApiError
from src.learning.repository_factory import make_repository as make_learning_repository
from src.learning.profile_config import (
    ALLOWED_CONSENT_KINDS,
    PROFILE_CONSENT_MIRRORS,
    profile_needs_onboarding,
    validate_patch as validate_learner_profile_patch,
)
from src.services.insights_copilot_planner import build_insights_planner_from_env
from src.services.insights_service import (
    InsightsAuthorizationError,
    InsightsService,
    _load_router_config_from_env,
)
from src.services.azure_openai_auth import build_openai_client
from src.safeguarding import (
    build_safeguarding_blueprint,
    configure_safeguarding_service,
    get_safeguarding_service,
)
from src.services.turn_router.handlers import ChitchatHandler
from src.services.insights_websocket_handler import InsightsVoiceHandler
from src.services.learner_voice_websocket_handler import LearnerVoiceSocketHandler
from src.services.voice_agent_action_service import (
    VoiceAgentActionError,
    VoiceAgentActionService,
)
from src.services.managers import AgentManager, ScenarioManager
from src.services.planning_service import PracticePlanningService
from src.services.report_pipeline import AzureOpenAIReportSummaryAssistant
from src.services.report_service import ProgressReportService
from src.services.recommendation_service import RecommendationService
from src.services import safety_gates
from src.services.storage_factory import create_storage_service
from src.services.telemetry import PilotTelemetryService
from src.services.transcript_safety import redact_transcript, summarise_for_storage
from src.services.websocket_handler import VoiceProxyHandler

# Constants
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = Path(__file__).resolve().parents[2]
INDEX_FILE = "index.html"
AUDIO_PROCESSOR_FILE = "audio-processor.js"


def resolve_static_folder() -> str:
    """Resolve the frontend bundle location for local source checkouts and containers."""
    candidate_paths = [
        BACKEND_DIR / "static",
        REPO_DIR / "frontend" / "static",
    ]

    for candidate in candidate_paths:
        if (candidate / INDEX_FILE).exists():
            return str(candidate)

    return str(candidate_paths[0])


STATIC_FOLDER = resolve_static_folder()
LOCAL_DEV_TRUSTED_ORIGINS = {
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://localhost:8000",
}


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
WEBSOCKET_ENDPOINT = "/ws/voice"

# API endpoints
API_CONFIG_ENDPOINT = "/api/config"
API_HEALTH_ENDPOINT = "/api/health"
API_SCENARIOS_ENDPOINT = "/api/scenarios"
API_EVENTS_ENDPOINT = "/api/events"
API_AUTH_SESSION_ENDPOINT = "/api/auth/session"
API_AUTH_CLAIM_INVITE_CODE_ENDPOINT = "/api/auth/claim-invite-code"
API_AUTH_CHOOSE_ROLE_ENDPOINT = "/api/auth/choose-role"
API_LEARNERS_SELF_ENDPOINT = "/api/learners/me"
API_LEARNERS_ME_PROFILE_ENDPOINT = "/api/learners/me/profile"
API_LEARNERS_ME_CONSENT_ENDPOINT = "/api/learners/me/consent"
API_ADMIN_INVITE_CODES_ENDPOINT = "/api/admin/invite-codes"
API_WORKSPACES_ENDPOINT = "/api/workspaces"
API_PILOT_STATE_ENDPOINT = "/api/pilot/state"
API_CONSENT_ENDPOINT = "/api/pilot/consent"
API_ME_UI_STATE_ENDPOINT = "/api/me/ui-state"
API_AGENTS_CREATE_ENDPOINT = "/api/agents/create"
API_ANALYZE_ENDPOINT = "/api/analyze"
API_ASSESS_UTTERANCE_ENDPOINT = "/api/assess-utterance"
API_TTS_ENDPOINT = "/api/tts"
API_CHILDREN_ENDPOINT = "/api/children"
API_CHILD_DETAIL_ENDPOINT = "/api/children/<child_id>"
API_INVITATIONS_ENDPOINT = "/api/invitations"
API_INVITATION_ACCEPT_ENDPOINT = "/api/invitations/<invitation_id>/accept"
API_INVITATION_DECLINE_ENDPOINT = "/api/invitations/<invitation_id>/decline"
API_INVITATION_REVOKE_ENDPOINT = "/api/invitations/<invitation_id>/revoke"
API_INVITATION_RESEND_ENDPOINT = "/api/invitations/<invitation_id>/resend"
API_FAMILY_INTAKE_INVITATIONS_ENDPOINT = "/api/family-intake/invitations"
API_FAMILY_INTAKE_INVITATION_ACCEPT_ENDPOINT = "/api/family-intake/invitations/<invitation_id>/accept"
API_FAMILY_INTAKE_INVITATION_DECLINE_ENDPOINT = "/api/family-intake/invitations/<invitation_id>/decline"
API_FAMILY_INTAKE_PROPOSALS_ENDPOINT = "/api/family-intake/proposals"
API_FAMILY_INTAKE_PENDING_PROPOSALS_ENDPOINT = "/api/family-intake/proposals/pending"
API_FAMILY_INTAKE_PROPOSAL_APPROVE_ENDPOINT = "/api/family-intake/proposals/<proposal_id>/approve"
API_FAMILY_INTAKE_PROPOSAL_REJECT_ENDPOINT = "/api/family-intake/proposals/<proposal_id>/reject"
API_FAMILY_INTAKE_PROPOSAL_RESUBMIT_ENDPOINT = "/api/family-intake/proposals/<proposal_id>/resubmit"
API_CHILD_SESSIONS_ENDPOINT = "/api/children/<child_id>/sessions"
API_CHILD_PLANS_ENDPOINT = "/api/children/<child_id>/plans"
API_CHILD_MEMORY_SUMMARY_ENDPOINT = "/api/children/<child_id>/memory/summary"
API_CHILD_MEMORY_ITEMS_ENDPOINT = "/api/children/<child_id>/memory/items"
API_CHILD_MEMORY_PROPOSALS_ENDPOINT = "/api/children/<child_id>/memory/proposals"
API_INSTITUTIONAL_MEMORY_INSIGHTS_ENDPOINT = "/api/institutional-memory/insights"
API_CHILD_RECOMMENDATIONS_ENDPOINT = "/api/children/<child_id>/recommendations"
API_CHILD_REPORTS_ENDPOINT = "/api/children/<child_id>/reports"
API_MEMORY_EVIDENCE_ENDPOINT = "/api/memory/<subject_type>/<subject_id>/evidence"
API_RECOMMENDATION_DETAIL_ENDPOINT = "/api/recommendations/<recommendation_id>"
API_REPORT_DETAIL_ENDPOINT = "/api/reports/<report_id>"
API_REPORT_EXPORT_ENDPOINT = "/api/reports/<report_id>/export"
API_REPORT_UPDATE_ENDPOINT = "/api/reports/<report_id>/update"
API_REPORT_SUMMARY_REWRITE_ENDPOINT = "/api/reports/<report_id>/summary-rewrite"
API_REPORT_APPROVE_ENDPOINT = "/api/reports/<report_id>/approve"
API_REPORT_SIGN_ENDPOINT = "/api/reports/<report_id>/sign"
API_REPORT_ARCHIVE_ENDPOINT = "/api/reports/<report_id>/archive"
API_SESSION_DETAIL_ENDPOINT = "/api/sessions/<session_id>"
API_SESSION_FEEDBACK_ENDPOINT = "/api/sessions/<session_id>/feedback"
API_PLANS_ENDPOINT = "/api/plans"
API_PLAN_DETAIL_ENDPOINT = "/api/plans/<plan_id>"
API_PLAN_MESSAGES_ENDPOINT = "/api/plans/<plan_id>/messages"
API_PLAN_APPROVE_ENDPOINT = "/api/plans/<plan_id>/approve"
API_MEMORY_PROPOSAL_APPROVE_ENDPOINT = "/api/memory/proposals/<proposal_id>/approve"
API_MEMORY_PROPOSAL_REJECT_ENDPOINT = "/api/memory/proposals/<proposal_id>/reject"
API_USER_ROLE_ENDPOINT = "/api/users/<user_id>/role"
API_IMAGES_ENDPOINT = "/api/images/<path:image_path>"
API_CHILD_CONSENT_ENDPOINT = "/api/children/<child_id>/consent"
API_CHILD_DATA_EXPORT_ENDPOINT = "/api/children/<child_id>/data-export"
API_CHILD_DATA_DELETE_ENDPOINT = "/api/children/<child_id>/data"

# Error messages
SCENARIO_ID_REQUIRED = "scenario_id is required"
SCENARIO_NOT_FOUND = "Scenario not found"
TRANSCRIPT_REQUIRED = "scenario_id and transcript are required"
UTTERANCE_REQUIRED = "utterance and reference_text are required"
AUTH_REQUIRED = "Authentication required"
THERAPIST_ROLE_REQUIRED = "Therapist role required"
SESSION_NOT_FOUND = "Session not found"
USER_NOT_FOUND = "User not found"
INVALID_ROLE = "Role must be 'therapist', 'parent', or 'admin'"
INVALID_FEEDBACK_RATING = "Feedback rating must be 'up' or 'down'"
PLAN_NOT_FOUND = "Practice plan not found"
REPORT_NOT_FOUND = "Progress report not found"
PLAN_MESSAGE_REQUIRED = "message is required"
PLANNER_SERVICE_UNAVAILABLE = "Planner service unavailable"
MEMORY_PROPOSAL_NOT_FOUND = "Child memory proposal not found"
CHILD_ACCESS_REQUIRED = "Child access required"
INVITATION_NOT_FOUND = "Invitation not found"

# HTTP status codes
HTTP_CREATED = 201
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_UNAUTHORIZED = 401
HTTP_INTERNAL_SERVER_ERROR = 500
HTTP_TOO_MANY_REQUESTS = 429

ROLE_THERAPIST = "therapist"
ROLE_PARENT = "parent"
ROLE_ADMIN = "admin"
ROLE_PENDING_THERAPIST = "pending_therapist"
ROLE_LEARNER = "learner"
ROLE_KID = "kid"
ROLE_STUDENT = "student"
ROLE_UNASSIGNED = "unassigned"
B2C_ONBOARDING_FLAG = "PATHFINDER_B2C_ONBOARDING_ENABLED"
LEARNER_ONBOARDING_FLAG = "PATHFINDER_LEARNER_ONBOARDING_ENABLED"
UNSAFE_HTTP_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
PATHFINDER_LEARN_TEACHER_CLASS_IDS_ENV = "PATHFINDER_LEARN_TEACHER_CLASS_IDS"
PATHFINDER_LEARN_LEARNER_STUDENT_IDS_ENV = "PATHFINDER_LEARN_LEARNER_STUDENT_IDS"
PATHFINDER_LEARN_ADMIN_TENANT_IDS_ENV = "PATHFINDER_LEARN_ADMIN_TENANT_IDS"
PATHFINDER_LEARN_CLASS_IDS = {
    "class-jss1-a",
    "class-jss2-a",
    "class-jss3-a",
    "class-ss1-a",
    "class-ss2-a",
    "class-ss3-a",
}
LEARNING_LEARNER_ROLES = {ROLE_PARENT, ROLE_LEARNER, ROLE_KID, ROLE_STUDENT}
LEARNER_VOICE_SCOPE_ROLES = {ROLE_LEARNER, ROLE_KID, ROLE_STUDENT, ROLE_THERAPIST, ROLE_ADMIN}
_RATE_LIMIT_STATE: dict[tuple[str, str], list[float]] = defaultdict(list)
_RATE_LIMIT_LOCK = threading.Lock()
_LEARNING_TEACHER_SCOPE_EMPTY_WARNED: set[tuple[str, str]] = set()


def _is_voice_scope_allowed_for_role(scope: str, role: str) -> bool:
    normalized_scope = (scope or "practice").strip().lower() or "practice"
    if normalized_scope not in {"learner", "learner_ask"}:
        return True
    return role in LEARNER_VOICE_SCOPE_ROLES


def _normalize_origin(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".lower().rstrip("/")


def _trusted_origins() -> set[str]:
    origins = {
        _normalize_origin(str(request.host_url or "")),
        _normalize_origin(str(config.get("public_app_url") or "")),
    }
    if not _is_azure_hosted_environment():
        origins.update(LOCAL_DEV_TRUSTED_ORIGINS)
        extra = str(os.environ.get("DEV_EXTRA_TRUSTED_ORIGINS") or "")
        for entry in extra.split(","):
            normalized = _normalize_origin(entry.strip())
            if normalized:
                origins.add(normalized)
    return {origin for origin in origins if origin}


def _is_state_changing_request() -> bool:
    return request.method.upper() in UNSAFE_HTTP_METHODS


def _is_local_dev_auth_enabled() -> bool:
    """Resolve LOCAL_DEV_AUTH dynamically so tests and shells cannot leak stale import-time state."""
    return str(os.environ.get("LOCAL_DEV_AUTH", str(config["local_dev_auth"]))).strip().lower() == "true"


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


if _is_local_dev_auth_enabled() and _is_azure_hosted_environment():
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in Azure-hosted environments.")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path=STATIC_URL_PATH)
sock = Sock(app)

# Kill switch for the SSE chat endpoint. Defaults on; set CHAT_STREAM_ENABLED=false
# to force the UI's one-shot fallback to /api/chat/ask.
app.config["chat_stream_enabled"] = os.getenv(
    "CHAT_STREAM_ENABLED", "true"
).strip().lower() in ("1", "true", "yes", "on")

# Initialize managers and analyzers
scenario_manager = ScenarioManager()
agent_manager = AgentManager()
conversation_analyzer = ConversationAnalyzer()
pronunciation_assessor = PronunciationAssessor()
voice_proxy_handler = VoiceProxyHandler(agent_manager)
telemetry_service = PilotTelemetryService(config["applicationinsights_connection_string"])
storage_service = None
planning_service = None
child_memory_service = None
institutional_memory_service = None
recommendation_service = None
report_service = None
email_service = None
insights_service: Optional[InsightsService] = None
planner_startup_readiness: Dict[str, Any] = {}


def initialize_runtime_services() -> None:
    """Initialize storage-backed services for the application runtime."""
    global storage_service
    global planning_service
    global child_memory_service
    global institutional_memory_service
    global recommendation_service
    global report_service
    global email_service
    global insights_service
    global planner_startup_readiness

    storage_service = create_storage_service(config.as_dict)
    child_memory_service = ChildMemoryService(storage_service)
    institutional_memory_service = InstitutionalMemoryService(storage_service)
    planning_service = PracticePlanningService(storage_service, scenario_manager)
    recommendation_service = RecommendationService(
        storage_service,
        scenario_manager,
        child_memory_service,
        institutional_memory_service,
    )
    report_service = ProgressReportService(
        storage_service,
        summary_assistant=AzureOpenAIReportSummaryAssistant.from_settings(config.as_dict),
    )
    email_service = AzureCommunicationEmailService.from_config(config.as_dict)
    insights_planner = None
    if os.environ.get("INSIGHTS_PLANNER_MODE", "auto").strip().lower() != "stub":
        try:
            # Use ``raw_dict`` (not ``as_dict``) so the planner receives the
            # real ``azure_openai_api_key`` instead of the redacted value.
            insights_planner = build_insights_planner_from_env(config.raw_dict)
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to build Copilot insights planner; falling back to stub")
            insights_planner = None
        if insights_planner is not None:
            logger.info("Insights planner: Copilot SDK adapter enabled")
        else:
            logger.info("Insights planner: using stub (SDK or credentials not configured)")
    router_config = _load_router_config_from_env()
    chitchat_handler = None
    if router_config.enabled:
        try:
            aoai_client = build_openai_client(config.raw_dict)
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to build AOAI client for chitchat handler")
            aoai_client = None
        if aoai_client is not None:
            chitchat_handler = ChitchatHandler(
                aoai_client,
                model=router_config.chitchat_model,
                timeout_seconds=router_config.chitchat_timeout_seconds,
                max_tokens=router_config.chitchat_max_tokens,
            )
            logger.info(
                "Insights router: enabled (shadow=%s, model=%s)",
                router_config.shadow,
                router_config.chitchat_model,
            )
        else:
            logger.warning(
                "Insights router enabled but AOAI client unavailable; chitchat will fall back to planner"
            )
    insights_service = InsightsService(
        storage_service,
        child_memory_service=child_memory_service,
        institutional_memory_service=institutional_memory_service,
        planner=insights_planner,
        tool_call_budget=int(
            os.environ.get("INSIGHTS_TOOL_CALL_BUDGET", "4") or "4"
        ),
        answer_cache_ttl_seconds=float(
            os.environ.get("INSIGHTS_ANSWER_CACHE_TTL_SECONDS", "300") or "300"
        ),
        answer_cache_max_entries=int(
            os.environ.get("INSIGHTS_ANSWER_CACHE_MAX_ENTRIES", "256") or "256"
        ),
        chitchat_handler=chitchat_handler,
        router_config=router_config,
    )
    planner_startup_readiness = planning_service.get_readiness(force_refresh=True)
    if not planner_startup_readiness.get("ready"):
        logger.warning("Planner readiness check failed at startup: %s", planner_startup_readiness)

    _initialize_safeguarding_service()


def _initialize_safeguarding_service() -> None:
    """Wire the safeguarding pipeline + notifier into the running app."""

    def _openai_factory():
        try:
            return build_openai_client(config.raw_dict)
        except Exception:  # noqa: BLE001
            logger.exception("Safeguarding: failed to build OpenAI client")
            return None

    def _email_sender(to: str, subject: str, plain: str, html: str) -> None:
        if email_service is None or email_service._client is None:  # type: ignore[attr-defined]
            return
        message = {
            "senderAddress": email_service._sender_address,  # type: ignore[attr-defined]
            "content": {"subject": subject, "plainText": plain, "html": html},
            "recipients": {"to": [{"address": to, "displayName": to}]},
            "headers": {"X-Wulo-Safeguarding": "1"},
        }
        try:
            poller = email_service._client.begin_send(message)  # type: ignore[attr-defined]
            poller.result()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Safeguarding email send failed for %s: %s", to, exc)
            raise

    def _parent_email_resolver(parent_user_id):
        if not parent_user_id or storage_service is None:
            return None
        try:
            user = storage_service.get_user(parent_user_id)  # type: ignore[attr-defined]
            if isinstance(user, dict):
                return user.get("email")
        except Exception:  # noqa: BLE001
            logger.debug("Parent email lookup failed for %s", parent_user_id, exc_info=True)
        return None

    try:
        configure_safeguarding_service(
            settings=config.raw_dict,
            openai_client_factory=_openai_factory,
            email_sender=_email_sender,
            parent_email_resolver=_parent_email_resolver,
        )
        logger.info("Safeguarding service: initialised")
    except Exception:  # noqa: BLE001
        logger.exception("Safeguarding service: initialisation failed (continuing without it)")


initialize_runtime_services()
learning_repository = make_learning_repository(storage_service=storage_service)
learning_api = register_learning_api(app, api=LearningApi(repository=learning_repository))
from src.learning.expiry_worker import maybe_start_expiry_worker

learner_memory_expiry_worker = maybe_start_expiry_worker(learning_repository)
from src.learning.offline_queue_drainer import maybe_start_offline_drainer

offline_queue_drain_worker = maybe_start_offline_drainer(learning_repository)
# Late-bind the learning API into the insights service so the planner can
# call Pathfinder Learn read-only tools (mastery snapshot, student profile,
# pending approvals).
if insights_service is not None:
    insights_service.learning_api = learning_api

voice_agent_action_service: VoiceAgentActionService = VoiceAgentActionService(
    learning_api=learning_api
)


def _refresh_static_folder() -> str:
    """Refresh the active static folder so local builds can be picked up without code changes."""
    if app.static_folder is None:
        return ""

    static_folder = resolve_static_folder()
    if app.static_folder != static_folder:
        app.static_folder = static_folder
    return static_folder


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
        "exercise_type": _normalize_telemetry_value(metadata.get("type") or metadata.get("exercise_type")),
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

    if not child_id:
        raise ValueError("child_id is required")

    name_hints = [child_name] if child_name else []
    transcript_report = redact_transcript(transcript, name_hints=name_hints)
    reference_report = redact_transcript(reference_text, name_hints=name_hints)
    safety_summary = {
        "transcript": dict(summarise_for_storage(transcript_report)),
        "reference_text": dict(summarise_for_storage(reference_report)),
    }
    if not (transcript_report.is_clean and reference_report.is_clean):
        logger.info(
            "transcript_safety: redacted child=%s scenario=%s summary=%s",
            child_id,
            scenario_id,
            safety_summary,
        )

    merged_metadata = dict(exercise_metadata or {})
    merged_metadata["_safety_redaction"] = safety_summary

    session = storage_service.save_session(
        {
            "child_id": child_id,
            "child_name": child_name,
            "exercise": _normalize_exercise_context(scenario_id, exercise_context, exercise_metadata),
            "exercise_metadata": merged_metadata,
            "ai_assessment": analysis_result.get("ai_assessment"),
            "pronunciation_assessment": analysis_result.get("pronunciation_assessment"),
            "transcript": transcript_report.redacted_text,
            "reference_text": reference_report.redacted_text,
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


def _resolve_local_dev_role() -> str:
    role = _normalize_context_value(os.environ.get("LOCAL_DEV_USER_ROLE")).lower()
    if role == "teacher":
        return ROLE_THERAPIST
    if role in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_LEARNER, ROLE_KID, ROLE_STUDENT}:
        return role

    if role:
        logger.warning("Ignoring unsupported LOCAL_DEV_USER_ROLE=%s; defaulting to therapist", role)

    return ROLE_THERAPIST


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

    if _is_local_dev_auth_enabled():
        user_id = os.environ.get("LOCAL_DEV_USER_ID", "local-dev-user")
        name = os.environ.get("LOCAL_DEV_USER_NAME", "Local Developer")
        email = os.environ.get("LOCAL_DEV_USER_EMAIL", "dev@localhost")
        provider = _normalize_identity_provider(os.environ.get("LOCAL_DEV_USER_PROVIDER", "local-dev"))
        role = _resolve_local_dev_role()
        user = storage_service.get_or_create_user(user_id, email, name, provider)
        if user.get("role") != role:
            if role in LEARNING_LEARNER_ROLES - {ROLE_PARENT}:
                return {**user, "role": role}
            updated_user = storage_service.update_user_role(user_id, role)
            if updated_user is not None:
                return updated_user

            user = {**user, "role": role}

        return user

    return None


def _get_authenticated_user() -> Optional[Dict[str, Any]]:
    if getattr(g, "authenticated_user_checked", False):
        return cast(Optional[Dict[str, Any]], getattr(g, "authenticated_user", None))

    user = _get_authenticated_user_from_headers(request.headers)
    g.authenticated_user_checked = True
    g.authenticated_user = user
    return user


def _rate_limit_for_request() -> Optional[tuple[int, int]]:
    if request.url_rule is None:
        return None

    rule = request.url_rule.rule
    window = int(config.get("rate_limit_default_window_seconds", 60))
    if rule == API_ME_UI_STATE_ENDPOINT and request.method in {"PATCH", "DELETE"}:
        return int(config.get("rate_limit_ui_state_limit", 60)), window
    if rule == API_ANALYZE_ENDPOINT:
        return int(config.get("rate_limit_analyze_limit", 30)), window
    if rule in {
        API_CHILD_PLANS_ENDPOINT,
        API_CHILD_REPORTS_ENDPOINT,
        API_PLANS_ENDPOINT,
        API_PLAN_MESSAGES_ENDPOINT,
        API_PLAN_APPROVE_ENDPOINT,
        API_REPORT_UPDATE_ENDPOINT,
        API_REPORT_APPROVE_ENDPOINT,
        API_REPORT_SIGN_ENDPOINT,
        API_REPORT_ARCHIVE_ENDPOINT,
    }:
        return int(config.get("rate_limit_plans_limit", 20)), window
    if rule in {
        API_INVITATIONS_ENDPOINT,
        API_INVITATION_ACCEPT_ENDPOINT,
        API_INVITATION_DECLINE_ENDPOINT,
        API_INVITATION_REVOKE_ENDPOINT,
        API_INVITATION_RESEND_ENDPOINT,
    }:
        return int(config.get("rate_limit_invitations_limit", 20)), window
    if rule == API_CHILD_DATA_EXPORT_ENDPOINT:
        return int(config.get("rate_limit_export_limit", 5)), 3600
    if rule == API_CHILD_DATA_DELETE_ENDPOINT:
        return int(config.get("rate_limit_delete_limit", 3)), 3600
    if _is_state_changing_request() and str(request.path or "").startswith("/api/"):
        return int(config.get("rate_limit_mutation_limit", 120)), window
    return None


def _rate_limit_actor_key() -> str:
    user = _get_authenticated_user()
    if user is not None:
        user_id = str(user.get("id") or "").strip()
        if user_id:
            return f"user:{user_id}"
    forwarded_for = str(request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    remote_addr = forwarded_for or str(request.remote_addr or "unknown")
    return f"ip:{remote_addr}"


def _check_rate_limit() -> Optional[Tuple[Any, int]]:
    policy = _rate_limit_for_request()
    if policy is None:
        return None

    limit, window_seconds = policy
    actor_key = _rate_limit_actor_key()
    route_key = request.url_rule.rule if request.url_rule is not None else request.path
    state_key = (actor_key, route_key)
    now = time.time()

    with _RATE_LIMIT_LOCK:
        bucket = [timestamp for timestamp in _RATE_LIMIT_STATE[state_key] if now - timestamp < window_seconds]
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            response = jsonify({"error": "Rate limit exceeded", "retry_after_seconds": retry_after})
            response.headers["Retry-After"] = str(retry_after)
            return response, HTTP_TOO_MANY_REQUESTS

        bucket.append(now)
        _RATE_LIMIT_STATE[state_key] = bucket

    return None


def _check_csrf_policy() -> Optional[Tuple[Any, int]]:
    if not _is_state_changing_request() or not str(request.path or "").startswith("/api/"):
        return None

    origin = _normalize_origin(str(request.headers.get("Origin") or ""))
    referer = _normalize_origin(str(request.headers.get("Referer") or ""))
    trusted_origins = _trusted_origins()
    # In local dev (non-Azure), allow any private/loopback origin on the common
    # dev ports so developers can use LAN IPs to test from phones/other devices.
    allow_private_dev = not _is_azure_hosted_environment()

    def _is_private_dev_origin(value: str) -> bool:
        if not allow_private_dev or not value:
            return False
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        if not host:
            return False
        if host in {"localhost", "127.0.0.1", "::1"}:
            return True
        if host.startswith("10.") or host.startswith("192.168."):
            return True
        if host.startswith("172."):
            try:
                second = int(host.split(".")[1])
                if 16 <= second <= 31:
                    return True
            except (ValueError, IndexError):
                return False
        return False

    if origin and origin not in trusted_origins and not _is_private_dev_origin(origin):
        return jsonify({"error": "Origin not allowed"}), HTTP_FORBIDDEN
    if not origin and referer and referer not in trusted_origins and not _is_private_dev_origin(referer):
        return jsonify({"error": "Referer not allowed"}), HTTP_FORBIDDEN

    content_length = request.content_length or 0
    if content_length > 0 and request.mimetype != "application/json":
        return jsonify({"error": "State-changing requests must use application/json"}), HTTP_BAD_REQUEST

    return None


@app.before_request
def _bind_storage_request_actor() -> None:
    _refresh_static_folder()

    user = _get_authenticated_user()
    if user is None:
        storage_service.clear_request_actor()
        return

    storage_service.set_request_actor(
        str(user.get("id") or "") or None,
        str(user.get("role") or "") or None,
        str(user.get("email") or "") or None,
    )


@app.before_request
def _enforce_request_security_controls() -> Optional[Tuple[Any, int]]:
    csrf_result = _check_csrf_policy()
    if csrf_result is not None:
        return csrf_result

    rate_limit_result = _check_rate_limit()
    if rate_limit_result is not None:
        return rate_limit_result

    return None


@app.before_request
def _disable_ws_permessage_deflate() -> None:
    """Keep WebSocket frames uncompressed so they survive intermediary proxies.

    ``simple_websocket`` unconditionally accepts ``PerMessageDeflate`` whenever
    a client offers it. Compressed frames get mangled by proxies that sit
    between the browser and Flask (notably Vite's dev ws proxy, which raises
    "Invalid frame header"), surfacing in the UI as a perpetual
    "Voice connection hiccup — retrying as you speak" loop. The frames here are
    tiny JSON, so compression buys nothing; dropping the client's offer means
    ``wsproto`` never negotiates the extension and frames stay plain. This is a
    no-op for same-origin production traffic.
    """
    if request.path.startswith("/ws/"):
        request.environ.pop("HTTP_SEC_WEBSOCKET_EXTENSIONS", None)


def _shutdown_ws_socket(ws: Any) -> None:
    """Send the WebSocket close frame and hard-shutdown the raw TCP socket.

    flask_sock on the Werkzeug dev server returns a normal ``Response`` after
    the view exits, which Werkzeug writes onto the *already-upgraded* socket.
    Those stray ``HTTP/1.1 200 OK`` bytes land in the middle of the WebSocket
    frame stream, so the browser parses them as a corrupt frame ("Invalid frame
    header"), tears the connection down as a 1006 abnormal closure, and the
    learner sees the perpetual "Voice connection hiccup" banner. By sending the
    close frame and then shutting down the underlying socket ourselves, that
    trailing HTTP write hits a closed socket and fails silently (BrokenPipe,
    swallowed by Werkzeug) instead of poisoning the stream. Same-origin
    production servers (gunicorn/eventlet) are unaffected — their flask_sock
    response path never writes a body onto the hijacked socket.
    """
    try:
        ws.close(1000)
    except Exception:
        logger.debug("Failed to send websocket close frame", exc_info=True)
    raw_sock = getattr(ws, "sock", None)
    if raw_sock is None:
        return
    try:
        raw_sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    except Exception:
        logger.debug("Failed to shutdown websocket socket", exc_info=True)
    try:
        raw_sock.close()
    except Exception:
        logger.debug("Failed to close websocket socket", exc_info=True)


@app.teardown_request
def _clear_storage_request_actor(_error: Optional[BaseException]) -> None:
    storage_service.clear_request_actor()


def _require_authenticated() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user = _get_authenticated_user()
    if user is None:
        return None, (jsonify({"error": AUTH_REQUIRED}), HTTP_UNAUTHORIZED)

    return user, None


def _require_therapist() -> Optional[Tuple[Any, int]]:
    _, guard_response = _require_therapist_user()
    return guard_response


def _require_therapist_user() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    return _require_role(ROLE_THERAPIST, ROLE_ADMIN)


def _require_therapist_ws(ws: simple_websocket.ws.Server) -> Optional[Dict[str, Any]]:
    environ = cast(Dict[str, Any], getattr(ws, "environ", {}) or {})
    ws_headers = {
        "X-MS-CLIENT-PRINCIPAL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL", ""),
        "X-MS-CLIENT-PRINCIPAL-ID": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_ID", ""),
        "X-MS-CLIENT-PRINCIPAL-NAME": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_NAME", ""),
        "X-MS-CLIENT-PRINCIPAL-IDP": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_IDP", ""),
        "X-MS-CLIENT-PRINCIPAL-EMAIL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_EMAIL", ""),
    }
    user = _get_authenticated_user_from_headers(ws_headers)
    if user is None:
        logger.warning("Rejected unauthenticated insights voice WebSocket connection")
        ws.close(4401, "insights_voice_unauthorized")
        return None

    if str(user.get("role") or "") not in {ROLE_THERAPIST, ROLE_ADMIN}:
        logger.warning(
            "Rejected non-therapist insights voice WebSocket connection for user %s",
            user.get("id"),
        )
        ws.close(4403, "insights_voice_forbidden")
        return None

    return user


def _require_role(*roles: str) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return None, guard_response

    if user is None or str(user.get("role") or "") not in set(roles):
        return None, (jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN)

    return user, None


app.register_blueprint(
    build_safeguarding_blueprint(
        require_admin=lambda: _require_role(ROLE_ADMIN),
        get_service=get_safeguarding_service,
    )
)


def _enforce_voice_safety_for_child(
    child_id: str,
) -> Optional[Tuple[Any, int]]:
    """Fail-closed gate for child voice sessions.

    Combines the global learner-voice kill switch with parental-consent
    fields persisted by ``child_parental_consent``. Returns a Flask
    response tuple when the request must be refused, or ``None`` to
    allow it through.
    """
    kill_decision = safety_gates.check_learner_voice_available()
    if not kill_decision.allowed:
        return (
            jsonify(
                {
                    "error": "learner_voice_disabled",
                    "reason": kill_decision.reason,
                }
            ),
            HTTP_FORBIDDEN,
        )
    try:
        consent = storage_service.get_parental_consent(child_id)
    except Exception:  # noqa: BLE001 - fail closed on storage errors
        logger.exception(
            "safety_gate: failed to load parental consent for child %s", child_id
        )
        return (
            jsonify({"error": "consent_lookup_failed"}),
            HTTP_FORBIDDEN,
        )
    consent_decision = safety_gates.check_voice_session_consent(consent or {})
    if not consent_decision.allowed:
        return (
            jsonify(
                {
                    "error": "missing_consent",
                    "reason": consent_decision.reason,
                    "missing": (consent_decision.detail or "").split(",")
                    if consent_decision.detail
                    else [],
                }
            ),
            HTTP_FORBIDDEN,
        )
    return None


def _enforce_data_consent_for_child(
    child_id: str,
) -> Optional[Tuple[Any, int]]:
    """Fail-closed gate for routes that read or modify stored child personal data.

    Unlike ``_enforce_voice_safety_for_child`` this gate does not check the
    learner-voice kill switch (the data already exists and may need to be read
    for SAR/erasure flows), only that the 4 data-side parental consent fields
    are still in place. If a parent withdraws consent mid-pilot, downstream
    reports/sessions/memory routes return 403 ``missing_consent`` until consent
    is restored or the data is exported/erased.
    """
    try:
        consent = storage_service.get_parental_consent(child_id)
    except Exception:  # noqa: BLE001 - fail closed on storage errors
        logger.exception(
            "data_consent_gate: failed to load parental consent for child %s",
            child_id,
        )
        return (
            jsonify({"error": "consent_lookup_failed"}),
            HTTP_FORBIDDEN,
        )
    decision = safety_gates.check_child_data_consent(consent or {})
    if not decision.allowed:
        return (
            jsonify(
                {
                    "error": "missing_consent",
                    "reason": decision.reason,
                    "missing": (decision.detail or "").split(",")
                    if decision.detail
                    else [],
                }
            ),
            HTTP_FORBIDDEN,
        )
    return None


def _require_child_access(
    child_id: str,
    *,
    allowed_roles: Optional[set[str]] = None,
    allowed_relationships: Optional[List[str]] = None,
    include_deleted: bool = False,
    enforce_data_consent: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return None, guard_response

    if user is None:
        return None, (jsonify({"error": AUTH_REQUIRED}), HTTP_UNAUTHORIZED)

    role = str(user.get("role") or "")
    if allowed_roles is not None and role not in allowed_roles:
        return None, (jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN)

    if not storage_service.user_has_child_access(
        str(user.get("id")),
        child_id,
        allowed_relationships=allowed_relationships,
        include_deleted=include_deleted,
    ):
        return None, (jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN)

    if enforce_data_consent:
        consent_guard = _enforce_data_consent_for_child(child_id)
        if consent_guard is not None:
            return None, consent_guard

    return user, None


def _csv_set(value: Optional[str]) -> set[str]:
    return {part.strip() for part in str(value or "").split(",") if part.strip()}


def _learning_payload() -> Dict[str, Any]:
    if request.method == "GET":
        return {key: value for key, value in request.args.items()}
    if request.form:
        return {key: value for key, value in request.form.items()}
    if request.is_json:
        payload = request.get_json(silent=True) or {}
        return payload if isinstance(payload, dict) else {}
    return {}


def _learning_student_id_from_path() -> Optional[str]:
    prefix = "/api/learning/students/"
    if not request.path.startswith(prefix):
        return None
    return request.path[len(prefix):].split("/", 1)[0] or None


def _learning_plan_id_from_path() -> Optional[str]:
    prefix = "/api/learning/approvals/"
    if not request.path.startswith(prefix) or request.path == "/api/learning/approvals/pending":
        return None
    return request.path[len(prefix):].split("/", 1)[0] or None


def _learning_plan_class_id(plan_id: Optional[str]) -> Optional[str]:
    if not plan_id:
        return None
    pending_plans = getattr(learning_api, "_pending_plans", {})
    record = pending_plans.get(plan_id) if isinstance(pending_plans, dict) else None
    if not record:
        return None
    class_id = str(record.get("class_id") or "").strip()
    return class_id or None


def _learning_diagnostic_session(payload: Mapping[str, Any]) -> Any:
    session_id = str(payload.get("session_id") or "").strip()
    if not session_id:
        return None
    sessions = getattr(learning_api, "_sessions", {})
    return sessions.get(session_id) if isinstance(sessions, dict) else None


def _learning_diagnostic_session_student_id(payload: Mapping[str, Any]) -> Optional[str]:
    state = _learning_diagnostic_session(payload)
    student_id = str(getattr(state, "student_id", "") or "").strip() if state else ""
    return student_id or None


def _learning_diagnostic_session_class_id(payload: Mapping[str, Any]) -> Optional[str]:
    state = _learning_diagnostic_session(payload)
    class_id = str(getattr(state, "class_id", "") or "").strip() if state else ""
    return class_id or None


def _learning_student_class_id(student_id: Optional[str], tenant_id: str) -> Optional[str]:
    if not student_id:
        return None
    student_classes = getattr(learning_api, "_student_classes", {})
    if isinstance(student_classes, dict):
        class_id = student_classes.get((tenant_id, student_id))
        if class_id:
            return str(class_id)

    if student_id == PILOT_STUDENT_ID or student_id.startswith("student-"):
        return PILOT_CLASS_ID

    marker = "-student-"
    if marker in student_id:
        return student_id.split(marker, 1)[0]
    return None


def _learning_teacher_class_ids(user: Mapping[str, Any]) -> set[str]:
    if str(user.get("role") or "") == ROLE_ADMIN:
        return set()
    configured = _csv_set(os.environ.get(PATHFINDER_LEARN_TEACHER_CLASS_IDS_ENV))
    if configured:
        return configured

    tenant_id = str(_learning_payload().get("tenant_id") or PILOT_TENANT_ID)
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        return set()
    try:
        class_ids = learning_repository.list_class_ids_for_teacher(tenant_id, user_id)
    except Exception:
        logger.exception("Learning teacher-scope lookup failed for user %s", user_id)
        return set()
    if not class_ids:
        warning_key = (tenant_id, user_id)
        if warning_key not in _LEARNING_TEACHER_SCOPE_EMPTY_WARNED:
            _LEARNING_TEACHER_SCOPE_EMPTY_WARNED.add(warning_key)
            logger.warning("Learning teacher %s has no persisted classes for tenant %s", user_id, tenant_id)
    return {str(class_id) for class_id in class_ids if str(class_id).strip()}


def _learning_admin_tenant_ids(user: Mapping[str, Any]) -> set[str]:
    configured = _csv_set(os.environ.get(PATHFINDER_LEARN_ADMIN_TENANT_IDS_ENV))
    if configured:
        return configured

    tenant_id = str(user.get("tenant_id") or user.get("current_tenant_id") or "").strip()
    if tenant_id:
        return {tenant_id}

    user_id = str(user.get("id") or "").strip()
    if user_id:
        try:
            persisted_user = storage_service.get_user(user_id)
        except Exception:
            logger.exception("Learning admin tenant lookup failed for user %s", user_id)
            persisted_user = None
        if isinstance(persisted_user, Mapping):
            tenant_id = str(
                persisted_user.get("tenant_id") or persisted_user.get("current_tenant_id") or ""
            ).strip()
            if tenant_id:
                return {tenant_id}

    return {PILOT_TENANT_ID}


def _learning_authorized_tenant_ids(user: Mapping[str, Any]) -> set[str]:
    """Tenant IDs the authenticated user may bind the learning RLS scope to.

    Admins use their configured/persisted admin tenants. Every other role is
    constrained to the tenant recorded on their identity (falling back to the
    pilot tenant) so a request body or query string can never widen the tenant
    scope used for row-level security.
    """
    if str(user.get("role") or "") == ROLE_ADMIN:
        return _learning_admin_tenant_ids(user)

    tenant_id = str(user.get("tenant_id") or user.get("current_tenant_id") or "").strip()
    if tenant_id:
        return {tenant_id}

    user_id = str(user.get("id") or "").strip()
    if user_id:
        try:
            persisted_user = storage_service.get_user(user_id)
        except Exception:
            logger.exception("Learning tenant lookup failed for user %s", user_id)
            persisted_user = None
        if isinstance(persisted_user, Mapping):
            tenant_id = str(
                persisted_user.get("tenant_id") or persisted_user.get("current_tenant_id") or ""
            ).strip()
            if tenant_id:
                return {tenant_id}

    return {PILOT_TENANT_ID}


def _learning_student_ids_for_user(user: Mapping[str, Any]) -> set[str]:
    configured = _csv_set(os.environ.get(PATHFINDER_LEARN_LEARNER_STUDENT_IDS_ENV))
    if configured:
        return configured
    try:
        children = storage_service.list_children_for_user(str(user.get("id") or ""))
    except Exception:
        logger.exception("Learning learner-scope lookup failed for user %s", user.get("id"))
        children = []
    return {str(child.get("id") or "") for child in children if child.get("id")}


def _learning_scope_from_request(payload: Mapping[str, Any]) -> tuple[str, Optional[str]]:
    tenant_id = str(payload.get("tenant_id") or PILOT_TENANT_ID)
    class_id = str(payload.get("class_id") or "").strip() or None
    plan_class_id = _learning_plan_class_id(_learning_plan_id_from_path())
    session_class_id = _learning_diagnostic_session_class_id(payload)
    student_class_id = _learning_student_class_id(_learning_student_id_from_path(), tenant_id)
    return tenant_id, class_id or plan_class_id or session_class_id or student_class_id


def _bind_learning_storage_scope(tenant_id: str, class_id: Optional[str]) -> None:
    set_learning_scope = getattr(storage_service, "set_learning_scope", None)
    if callable(set_learning_scope):
        set_learning_scope(tenant_id, class_id)


def _learning_class_guard(user: Mapping[str, Any], class_id: Optional[str]) -> Optional[Tuple[Any, int]]:
    if str(user.get("role") or "") == ROLE_ADMIN or not class_id:
        return None
    if class_id not in _learning_teacher_class_ids(user):
        return jsonify({"error": "Class access required"}), HTTP_FORBIDDEN
    return None


def _learning_student_guard(user: Mapping[str, Any], student_id: str) -> Optional[Tuple[Any, int]]:
    role = str(user.get("role") or "")
    if role == ROLE_ADMIN:
        return None
    tenant_id = str(_learning_payload().get("tenant_id") or PILOT_TENANT_ID)
    if role == ROLE_THERAPIST:
        return _learning_class_guard(user, _learning_student_class_id(student_id, tenant_id))
    if role in LEARNING_LEARNER_ROLES and student_id in _learning_student_ids_for_user(user):
        return None
    return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN


def _learning_admin_endpoint(path: str, method: str) -> bool:
    return (
        path in {"/api/learning/audit", "/api/learning/kpis", "/api/learning/observability/config", "/api/learning/metrics"}
        or (path == "/api/learning/skills" and method == "POST")
        or (path.startswith("/api/learning/skills/") and method == "POST")
    )


def _learning_teacher_endpoint(path: str) -> bool:
    return (
        path == "/api/learning/class/mastery"
        or path.startswith("/api/learning/approvals")
        or path == "/api/learning/intent"
        or path.endswith("/override") and path.startswith("/api/learning/students/")
        or path == "/api/learning/skills"
        or path.startswith("/api/learning/skills/")
    )


@app.before_request
def _enforce_learning_api_policy() -> Optional[Tuple[Any, int]]:
    path = str(request.path or "")
    if not path.startswith("/api/learning/"):
        return None
    if path in {"/api/learning/lti/login", "/api/learning/lti/launch"}:
        return None

    payload = _learning_payload()
    tenant_id, class_id = _learning_scope_from_request(payload)

    # Authenticate once and constrain the tenant to the caller's identity before
    # binding the RLS scope. This prevents a request body/query from widening the
    # tenant used for row-level security (cross-tenant access).
    user, guard_response = _require_authenticated()
    if guard_response is not None or user is None:
        return guard_response

    authorized_tenant_ids = _learning_authorized_tenant_ids(user)
    if authorized_tenant_ids and tenant_id not in authorized_tenant_ids:
        _bind_learning_storage_scope(sorted(authorized_tenant_ids)[0], class_id)
        return jsonify({"error": "Tenant access required"}), HTTP_FORBIDDEN

    _bind_learning_storage_scope(tenant_id, class_id)

    if _learning_admin_endpoint(path, request.method):
        user, guard_response = _require_role(ROLE_ADMIN)
        if guard_response is not None or user is None:
            return guard_response
        admin_tenant_ids = _learning_admin_tenant_ids(user)
        if admin_tenant_ids and tenant_id not in admin_tenant_ids:
            _bind_learning_storage_scope(sorted(admin_tenant_ids)[0], class_id)
            return jsonify({"error": "Tenant access required"}), HTTP_FORBIDDEN
        _bind_learning_storage_scope(tenant_id, class_id)
        return None

    student_id = _learning_student_id_from_path()
    if student_id and request.method == "GET":
        user, guard_response = _require_authenticated()
        if guard_response is not None or user is None:
            return guard_response
        return _learning_student_guard(user, student_id)

    if _learning_teacher_endpoint(path):
        user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
        if guard_response is not None or user is None:
            return guard_response
        return _learning_class_guard(user, class_id)

    user, guard_response = _require_authenticated()
    if guard_response is not None or user is None:
        return guard_response

    role = str(user.get("role") or "")
    if role == ROLE_PENDING_THERAPIST:
        return jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN
    if role in {ROLE_THERAPIST, ROLE_ADMIN}:
        return _learning_class_guard(user, class_id)
    if role in LEARNING_LEARNER_ROLES:
        payload_student_id = str(payload.get("student_id") or payload.get("actor_id") or "").strip()
        session_student_id = _learning_diagnostic_session_student_id(payload)
        owned_student_ids = _learning_student_ids_for_user(user)
        if path in {"/api/learning/diagnostic/start", "/api/learning/voice/frame"} and not payload_student_id:
            return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        if path == "/api/learning/voice/turn":
            child_id = str(payload.get("child_id") or "").strip()
            if not child_id or child_id not in owned_student_ids:
                return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        if path == "/api/learning/diagnostic/answer" and session_student_id and session_student_id not in owned_student_ids:
            return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        if payload_student_id and payload_student_id not in owned_student_ids:
            return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        if path.startswith("/api/learning/notifications/"):
            payload_user_id = str(payload.get("user_id") or "").strip()
            if payload_user_id and payload_user_id not in owned_student_ids:
                return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        return None
    return jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN


def _insights_rail_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Return whether the Phase 4 Insights Agent UI is enabled for ``user``.

    Only therapists and admins see the rail. The ``INSIGHTS_RAIL_ENABLED``
    environment variable (default: on) lets staging/prod dark-launch by
    setting it to ``0``/``false``/``no``/``off``.
    """
    if user is None:
        return False
    role = str(user.get("role") or "")
    if role not in (ROLE_THERAPIST, ROLE_ADMIN):
        return False
    raw = os.getenv("INSIGHTS_RAIL_ENABLED")
    if raw is None:
        return True
    return str(raw).strip().lower() not in {"0", "false", "no", "off", ""}


def _insights_voice_mode_for(user: Optional[Dict[str, Any]]) -> str:
    if user is None:
        return "off"
    if str(user.get("role") or "") not in {ROLE_THERAPIST, ROLE_ADMIN}:
        return "off"
    mode = str(os.getenv("INSIGHTS_VOICE_MODE", "off") or "off").strip().lower()
    if mode == "push_to_talk":
        return "full_duplex"
    if mode == "full_duplex":
        return mode
    return "off"


def _voice_agent_fullscreen_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether the fullscreen voice-agent overlay entry point is shown.

    Gated by VOICE_AGENT_FULLSCREEN_ENABLED (default off) and requires a
    non-off insights voice mode for the calling user so we never expose a
    launcher that immediately fails to connect.
    """
    if user is None:
        return False
    if _insights_voice_mode_for(user) == "off":
        return False
    raw = os.getenv("VOICE_AGENT_FULLSCREEN_ENABLED", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _voice_agent_dynamic_ui_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether the voice agent may render dynamic UI specs in the overlay."""
    if not _voice_agent_fullscreen_enabled(user):
        return False
    raw = os.getenv("VOICE_AGENT_DYNAMIC_UI_ENABLED", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _voice_agent_actions_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether the voice agent may propose & execute mutating actions."""
    if not _voice_agent_dynamic_ui_enabled(user):
        return False
    raw = os.getenv("VOICE_AGENT_ACTIONS_ENABLED", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _learner_voice_fullscreen_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether the learner fullscreen voice + gen-UI surface is shown.

    Distinct from VOICE_AGENT_FULLSCREEN_ENABLED, which gates the
    therapist-side caseload voice agent. The learner surface has its
    own card contract (mcq-tap, explanation, progress) and its own
    backend turn endpoint.
    """
    if user is None:
        return False
    role = str(user.get("role") or "")
    if role not in LEARNING_LEARNER_ROLES:
        return False
    raw = os.getenv("LEARNER_VOICE_FULLSCREEN_ENABLED", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _pathfinder_voicelive_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether the AskPathfinder voice surface uses Azure VoiceLive.

    When off, the client falls back to the browser Web Speech API. Gated to
    learner roles so the neural-voice realtime path is only offered where the
    ``learner_ask`` VoiceLive scope is authorized.
    """
    if user is None:
        return False
    role = str(user.get("role") or "")
    if role not in LEARNING_LEARNER_ROLES:
        return False
    raw = os.getenv("PATHFINDER_VOICELIVE_ENABLED", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _log_audit_event(
    *,
    user_id: Optional[str],
    action: str,
    resource_type: str,
    resource_id: str,
    child_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        storage_service.log_audit_event(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            child_id=child_id,
            metadata=metadata,
        )
    except Exception:
        logger.exception("Audit logging failed for %s %s", resource_type, resource_id)


def _serialize_invitation_email_delivery(
    result: InvitationEmailDeliveryResult,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "status": result.status,
        "attempted": result.attempted,
        "delivered": result.delivered,
    }
    if result.provider_message_id:
        payload["provider_message_id"] = result.provider_message_id
    if result.error:
        payload["error"] = result.error
    return payload


def _send_invitation_email(
    invitation: Dict[str, Any],
    *,
    inviter_name: str,
) -> Dict[str, Any]:
    if email_service is None:
        result = InvitationEmailDeliveryResult(
            status="not_configured",
            attempted=False,
            delivered=False,
            error="Email service is not configured",
        )
        return _serialize_invitation_email_delivery(result)

    delivery_result = email_service.send_invitation_email(
        recipient_email=str(invitation.get("invited_email") or ""),
        invitation_id=str(invitation.get("id") or ""),
        child_name=str(invitation.get("child_name") or "your child profile"),
        inviter_name=inviter_name,
        relationship=str(invitation.get("relationship") or ROLE_PARENT),
        expires_at=str(invitation.get("expires_at") or "") or None,
    )
    delivery_payload = _serialize_invitation_email_delivery(delivery_result)

    if delivery_result.status == "failed":
        logger.warning(
            "Invitation email delivery failed for %s to %s: %s",
            invitation.get("id"),
            invitation.get("invited_email"),
            delivery_result.error,
        )

    return delivery_payload


def _send_family_intake_invitation_email(
    invitation: Dict[str, Any],
    *,
    inviter_name: str,
) -> Dict[str, Any]:
    if email_service is None:
        result = InvitationEmailDeliveryResult(
            status="not_configured",
            attempted=False,
            delivered=False,
            error="Email service is not configured",
        )
        return _serialize_invitation_email_delivery(result)

    delivery_result = email_service.send_family_intake_invitation_email(
        recipient_email=str(invitation.get("invited_email") or ""),
        invitation_id=str(invitation.get("id") or ""),
        workspace_name=str(invitation.get("workspace_name") or "your workspace"),
        inviter_name=inviter_name,
        expires_at=str(invitation.get("expires_at") or "") or None,
    )
    delivery_payload = _serialize_invitation_email_delivery(delivery_result)

    if delivery_result.status == "failed":
        logger.warning(
            "Family intake invitation email delivery failed for %s to %s: %s",
            invitation.get("id"),
            invitation.get("invited_email"),
            delivery_result.error,
        )

    return delivery_payload


def _persist_invitation_email_delivery(invitation_id: str, delivery_payload: Dict[str, Any]) -> None:
    try:
        storage_service.record_child_invitation_email_delivery(invitation_id, delivery_payload)
    except Exception:
        logger.exception("Invitation email delivery persistence failed for %s", invitation_id)


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
    static_folder = _refresh_static_folder()
    if not static_folder or not (Path(static_folder) / INDEX_FILE).exists():
        logger.error("Static bundle is missing. Cannot serve index.html from %s.", static_folder)
        import sys  # pylint: disable=C0415

        sys.exit(1)

    return send_from_directory(static_folder, INDEX_FILE)


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
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    return jsonify(
        {
            "status": "ok",
            "proxy_enabled": True,
            "ws_endpoint": WEBSOCKET_ENDPOINT,
            "storage_ready": True,
            "telemetry_enabled": telemetry_service.enabled,
            "appinsights_connection_string": config.get("applicationinsights_connection_string", ""),
            "image_base_path": "/api/images",
            "planner": planning_service.get_readiness(),
            "insights_rail_enabled": _insights_rail_enabled(cast(Dict[str, Any], user) if user else None),
            "insights_voice_mode": _insights_voice_mode_for(cast(Dict[str, Any], user) if user else None),
            "voice_agent_fullscreen_enabled": _voice_agent_fullscreen_enabled(cast(Dict[str, Any], user) if user else None),
            "voice_agent_dynamic_ui_enabled": _voice_agent_dynamic_ui_enabled(cast(Dict[str, Any], user) if user else None),
            "voice_agent_actions_enabled": _voice_agent_actions_enabled(cast(Dict[str, Any], user) if user else None),
            "learner_voice_fullscreen_enabled": _learner_voice_fullscreen_enabled(cast(Dict[str, Any], user) if user else None),
            "pathfinder_voicelive_enabled": _pathfinder_voicelive_enabled(cast(Dict[str, Any], user) if user else None),
            "safety": dict(safety_gates.public_status_payload()),
            "onboarding": {
                # Kill switch for the v2 onboarding/guidance system
                # (docs/onboarding/onboarding-plan-v2.md). Setting
                # ONBOARDING_TOURS_ENABLED=false via azd env disables
                # all tours without a release.
                "tours_enabled": os.environ.get("ONBOARDING_TOURS_ENABLED", "true").strip().lower()
                not in ("false", "0", "no"),
                "forced_reset": os.environ.get("ONBOARDING_FORCED_RESET", "false").strip().lower()
                in ("true", "1", "yes"),
            },
        }
    )


@app.route(API_HEALTH_ENDPOINT)
def health():
    """Return a minimal health payload for ingress and auth exclusions."""
    return jsonify({"status": "ok"})


# Allow-listed telemetry event names. Keep this list narrow; any unknown
# name is dropped with a 202 so the client never blocks on telemetry.
_ALLOWED_TELEMETRY_EVENTS = frozenset(
    {
        "parent_summary_shared",
        "trust_badge_clicked",
        "voice_pill_state_changed",
    }
)
_TELEMETRY_MAX_PROPS_BYTES = 2048
# Per-user, in-process rate limit. Process-local only, but enough to stop a
# single tab from drowning the logger if a state-change loop misbehaves.
_TELEMETRY_RATE_LIMIT_WINDOW_SECONDS = 60.0
_TELEMETRY_RATE_LIMIT_MAX_EVENTS = 60
_telemetry_rate_buckets: Dict[str, Tuple[float, int]] = {}
_telemetry_rate_lock = threading.Lock()
telemetry_logger = logging.getLogger("pathfinder.telemetry")


def _telemetry_rate_limit_check(user_id: str) -> bool:
    """Return True when the caller is within budget, False when throttled."""
    if not user_id:
        return True
    now = time.monotonic()
    with _telemetry_rate_lock:
        window_start, count = _telemetry_rate_buckets.get(user_id, (now, 0))
        if now - window_start >= _TELEMETRY_RATE_LIMIT_WINDOW_SECONDS:
            _telemetry_rate_buckets[user_id] = (now, 1)
            return True
        if count >= _TELEMETRY_RATE_LIMIT_MAX_EVENTS:
            return False
        _telemetry_rate_buckets[user_id] = (window_start, count + 1)
        return True


@app.route(API_EVENTS_ENDPOINT, methods=["POST"])
def post_event():
    """Best-effort telemetry sink. Logs structured events; no DB writes."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response
    user_id = str((user or {}).get("id") or "")
    if not _telemetry_rate_limit_check(user_id):
        return jsonify({"accepted": False, "reason": "rate_limited"}), 429
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    if not isinstance(name, str) or name not in _ALLOWED_TELEMETRY_EVENTS:
        return jsonify({"accepted": False, "reason": "unknown_event"}), 202
    props = body.get("props") if isinstance(body.get("props"), dict) else None
    if props is not None:
        try:
            if len(json.dumps(props)) > _TELEMETRY_MAX_PROPS_BYTES:
                props = {"_truncated": True}
        except (TypeError, ValueError):
            props = None
    telemetry_logger.info(
        "pathfinder.event",
        extra={
            "event_name": name,
            "event_props": props,
            "user_id": user_id,
            "client_ts": body.get("ts"),
        },
    )
    return jsonify({"accepted": True}), 202


@app.route(API_AUTH_SESSION_ENDPOINT)
def get_auth_session():
    """Return the authenticated user session derived from Easy Auth headers."""
    user = _get_authenticated_user()
    if user is None:
        return jsonify({"authenticated": False}), HTTP_UNAUTHORIZED

    return jsonify(_build_session_payload(cast(Dict[str, Any], user)))


def _build_session_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    """Compose the auth-session response for a resolved user dict."""
    user_id = str(user.get("id") or "")
    role = str(user.get("role") or "")
    user_workspaces = storage_service.list_workspaces_for_user(user_id)
    default_workspace = storage_service.get_default_workspace_for_user(user_id)
    is_self_learner = False
    try:
        is_self_learner = bool(storage_service.has_self_learner(user_id))
    except (AttributeError, TypeError):
        is_self_learner = False
    except Exception:  # pragma: no cover - defensive
        is_self_learner = False
    return {
        "authenticated": True,
        "user_id": user_id,
        "name": user.get("name") or "",
        "email": user.get("email") or "",
        "provider": user.get("provider") or "",
        "role": role,
        "needs_onboarding": role == ROLE_UNASSIGNED,
        "is_self_learner": is_self_learner,
        "current_workspace_id": None if default_workspace is None else default_workspace["id"],
        "user_workspaces": user_workspaces,
    }


@app.route(API_AUTH_CLAIM_INVITE_CODE_ENDPOINT, methods=["POST"])
def claim_invite_code():
    """Allow a pending_therapist user to redeem an invite code and become a therapist."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")
    role = str(cast(Dict[str, Any], user).get("role") or "")
    if role != ROLE_PENDING_THERAPIST:
        return jsonify({"error": "Only pending therapists can claim invite codes"}), HTTP_BAD_REQUEST

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    code = str(data.get("code") or "").strip()
    if not code:
        return jsonify({"error": "Invite code is required"}), HTTP_BAD_REQUEST

    success = storage_service.claim_invite_code(code, user_id)
    if not success:
        return jsonify({"error": "Invalid or already used invite code"}), HTTP_BAD_REQUEST

    _log_audit_event(
        user_id=user_id,
        action="invite_code.claim",
        resource_type="invite_code",
        resource_id=code,
    )

    # Return fresh session data
    updated_user = storage_service.get_user(user_id)
    if updated_user is None:
        return jsonify({"error": "User not found"}), HTTP_NOT_FOUND
    return jsonify(_build_session_payload(updated_user))


@app.route(API_AUTH_CHOOSE_ROLE_ENDPOINT, methods=["POST"])
def choose_role():
    """Post-signup role picker. Lets an unassigned user pick learner/parent/teacher.

    Body: {"intent": "learner" | "parent" | "teacher"}.
    """
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    user_dict = cast(Dict[str, Any], user)
    user_id = str(user_dict.get("id") or "")
    current_role = str(user_dict.get("role") or "")
    if current_role != ROLE_UNASSIGNED:
        return jsonify({"error": "Role has already been chosen"}), HTTP_BAD_REQUEST

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    intent = str(data.get("intent") or "").strip().lower()
    if intent == "learner":
        target_role = ROLE_LEARNER
    elif intent == "parent":
        target_role = ROLE_PARENT
    elif intent == "teacher":
        target_role = ROLE_PENDING_THERAPIST
    else:
        return jsonify({"error": "intent must be one of: learner, parent, teacher"}), HTTP_BAD_REQUEST

    try:
        storage_service.update_user_role(user_id, target_role)
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if target_role == ROLE_LEARNER:
        try:
            storage_service.find_or_create_self_learner(
                user_id=user_id,
                name=str(user_dict.get("name") or ""),
                email=str(user_dict.get("email") or ""),
            )
        except Exception as error:  # pragma: no cover - defensive
            logger.exception("Failed to bootstrap self-learner: %s", error)

    _log_audit_event(
        user_id=user_id,
        action="auth.choose_role",
        resource_type="user",
        resource_id=user_id,
        metadata={"intent": intent, "role": target_role},
    )

    updated_user = storage_service.get_user(user_id)
    if updated_user is None:
        return jsonify({"error": "User not found"}), HTTP_NOT_FOUND
    return jsonify(_build_session_payload(updated_user))


@app.route(API_LEARNERS_SELF_ENDPOINT, methods=["POST"])
def create_self_learner():
    """Idempotently return (creating if necessary) the caller's self-learner child."""
    user, guard_response = _require_role(ROLE_LEARNER)
    if guard_response is not None:
        return guard_response

    user_dict = cast(Dict[str, Any], user)
    user_id = str(user_dict.get("id") or "")
    try:
        child = storage_service.find_or_create_self_learner(
            user_id=user_id,
            name=str(user_dict.get("name") or ""),
            email=str(user_dict.get("email") or ""),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    _log_audit_event(
        user_id=user_id,
        action="learner.self_create",
        resource_type="child",
        resource_id=str(child.get("id") or ""),
        child_id=str(child.get("id") or ""),
    )
    return jsonify(child)


def _pathfinder_learner_onboarding_enabled() -> bool:
    return os.environ.get(LEARNER_ONBOARDING_FLAG, "false").strip().lower() in {
        "true",
        "1",
        "yes",
    }


def _learner_profile_response(user_id: str) -> Dict[str, Any]:
    profile = storage_service.get_learner_profile(user_id) or {}
    consents = storage_service.latest_consents(user_id)
    return {
        "profile": profile,
        "consents": consents,
        "needs_onboarding": profile_needs_onboarding(profile, consents),
    }


@app.route(API_LEARNERS_ME_PROFILE_ENDPOINT, methods=["GET", "PATCH"])
def learner_self_profile():
    """Return or update the calling learner's profile."""
    if not _pathfinder_learner_onboarding_enabled():
        return jsonify({"error": "Not found"}), HTTP_NOT_FOUND

    user, guard_response = _require_role(ROLE_LEARNER)
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")

    if request.method == "GET":
        return jsonify(_learner_profile_response(user_id))

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    cleaned, error = validate_learner_profile_patch(data)
    if error is not None:
        return jsonify({"error": error}), HTTP_BAD_REQUEST

    storage_service.upsert_learner_profile(user_id, cleaned)
    _log_audit_event(
        user_id=user_id,
        action="learner.profile_update",
        resource_type="learner_profile",
        resource_id=user_id,
        metadata={"fields": sorted(cleaned.keys())},
    )
    return jsonify(_learner_profile_response(user_id))


@app.route(API_LEARNERS_ME_CONSENT_ENDPOINT, methods=["POST"])
def learner_self_consent():
    """Record a consent grant/revoke for the calling learner."""
    if not _pathfinder_learner_onboarding_enabled():
        return jsonify({"error": "Not found"}), HTTP_NOT_FOUND

    user, guard_response = _require_role(ROLE_LEARNER)
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")
    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    kind = str(data.get("kind") or "").strip().lower()
    version = str(data.get("version") or "").strip()
    granted_raw = data.get("granted")

    if kind not in ALLOWED_CONSENT_KINDS:
        return jsonify({"error": "Unsupported consent kind"}), HTTP_BAD_REQUEST
    if not version:
        return jsonify({"error": "version is required"}), HTTP_BAD_REQUEST
    if not isinstance(granted_raw, bool):
        return jsonify({"error": "granted must be a boolean"}), HTTP_BAD_REQUEST

    user_agent = request.headers.get("User-Agent")
    storage_service.record_consent(
        user_id,
        kind,
        version,
        granted_raw,
        user_agent=user_agent[:255] if user_agent else None,
    )

    mirror_field = PROFILE_CONSENT_MIRRORS.get(kind)
    if mirror_field is not None:
        storage_service.upsert_learner_profile(user_id, {mirror_field: bool(granted_raw)})

    _log_audit_event(
        user_id=user_id,
        action="learner.consent_record",
        resource_type="user_consent",
        resource_id=user_id,
        metadata={"kind": kind, "version": version, "granted": bool(granted_raw)},
    )
    return jsonify(_learner_profile_response(user_id))


_LEARNER_PLAN_YEAR_GROUP_TO_CLASS_YEAR: Dict[str, str] = {
    "JSS1": "JSS1",
    "JSS2": "JSS2",
    "JSS3": "JSS3",
    "SS1": "SSS1",
    "SS2": "SSS2",
    "SS3": "SSS3",
}

_LEARNER_PLAN_SUBJECT_ALIASES: Dict[str, str] = {
    "maths": "Mathematics",
    "mathematics": "Mathematics",
    "english language": "English",
    "english": "English",
}


@app.route("/api/learning/learner/plan", methods=["GET"])
def learner_daily_plan():
    """Return an adaptive, mastery-ranked daily plan for the calling learner."""
    if not _pathfinder_learner_onboarding_enabled():
        return jsonify({"error": "Not found"}), HTTP_NOT_FOUND

    user, guard_response = _require_role(ROLE_LEARNER)
    if guard_response is not None:
        return guard_response

    owned_student_ids = _learning_student_ids_for_user(cast(Dict[str, Any], user))
    requested = str(request.args.get("student_id") or "").strip()
    if requested:
        if requested not in owned_student_ids:
            return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN
        student_id = requested
    else:
        student_id = next(iter(sorted(owned_student_ids)), "")
    if not student_id:
        return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN

    user_id = str(cast(Dict[str, Any], user).get("id") or "")
    profile = storage_service.get_learner_profile(user_id) or {}

    plan_payload: Dict[str, Any] = {"student_id": student_id}
    exam = str(profile.get("exam") or "").strip()
    if exam:
        plan_payload["exam"] = exam
    class_year = _LEARNER_PLAN_YEAR_GROUP_TO_CLASS_YEAR.get(
        str(profile.get("year_group") or "").strip()
    )
    if class_year:
        plan_payload["class_year"] = class_year
    subjects = profile.get("subjects")
    if isinstance(subjects, list):
        for raw_subject in subjects:
            alias = _LEARNER_PLAN_SUBJECT_ALIASES.get(str(raw_subject).strip().lower())
            if alias:
                plan_payload["subject"] = alias
                break

    try:
        plan = learning_api.build_learner_plan(plan_payload)
    except LearningApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    return jsonify(plan)


@app.route("/api/learning/exam-prep/topics", methods=["GET"])
def exam_prep_topics():
    """Return the full exam-prep topic catalogue grouped by subject.

    This is read-only learner content (the diagnostic topic breakdown the
    exam-prep library binds to), so it is intentionally not gated behind the
    learner-onboarding feature flag.
    """
    _user, guard_response = _require_role(ROLE_LEARNER)
    if guard_response is not None:
        return guard_response

    try:
        catalogue = learning_api.build_exam_prep_topics()
    except LearningApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    return jsonify(catalogue)


@app.route(API_ADMIN_INVITE_CODES_ENDPOINT, methods=["GET", "POST"])
def admin_invite_codes():
    """Admin endpoint to create and list therapist invite codes."""
    user, guard_response = _require_role(ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")

    if request.method == "GET":
        return jsonify(storage_service.list_invite_codes(user_id))

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    code = str(data.get("code") or "").strip().upper()
    if not code or len(code) < 4:
        return jsonify({"error": "Code must be at least 4 characters"}), HTTP_BAD_REQUEST

    try:
        invite = storage_service.create_invite_code(code, user_id)
    except Exception:
        return jsonify({"error": "Code already exists"}), HTTP_BAD_REQUEST

    _log_audit_event(
        user_id=user_id,
        action="invite_code.create",
        resource_type="invite_code",
        resource_id=str(invite.get("id") or ""),
        metadata={"code": code},
    )

    return jsonify(invite), HTTP_CREATED


@app.route(API_WORKSPACES_ENDPOINT, methods=["GET", "POST"])
def workspaces():
    """List or create therapist workspaces for the authenticated user."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")
    if request.method == "GET":
        return jsonify(storage_service.list_workspaces_for_user(user_id))

    if str(cast(Dict[str, Any], user).get("role") or "") not in {ROLE_THERAPIST, ROLE_ADMIN}:
        return jsonify({"error": "Therapist role required"}), HTTP_FORBIDDEN

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})

    try:
        workspace = storage_service.create_workspace(user_id, data.get("name"))
    except ValueError:
        return jsonify({"error": USER_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=user_id,
        action="workspace.create",
        resource_type="workspace",
        resource_id=str(workspace.get("id") or ""),
        metadata={"name": workspace.get("name"), "is_personal": workspace.get("is_personal")},
    )
    return jsonify(workspace), 201


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


@app.route(API_CHILD_CONSENT_ENDPOINT, methods=["GET", "POST", "DELETE"])
def child_parental_consent(child_id: str):
    """Manage parental/guardian consent for a child profile."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_LEARNER},
    )
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id"))

    if request.method == "GET":
        consent = storage_service.get_parental_consent(child_id)
        return jsonify({"consent": consent})

    if request.method == "DELETE":
        withdrawn = storage_service.withdraw_parental_consent(child_id)
        _log_audit_event(
            user_id=user_id,
            action="parental_consent.withdraw",
            resource_type="parental_consent",
            resource_id=child_id,
            child_id=child_id,
        )
        return jsonify({"withdrawn": withdrawn})

    # POST
    body = request.get_json(silent=True) or {}
    guardian_name = str(body.get("guardian_name") or "").strip()
    guardian_email = str(body.get("guardian_email") or "").strip()
    if not guardian_name or not guardian_email:
        return jsonify({"error": "guardian_name and guardian_email are required"}), 400

    consent = storage_service.save_parental_consent(
        child_id=child_id,
        guardian_name=guardian_name,
        guardian_email=guardian_email,
        privacy_accepted=bool(body.get("privacy_accepted", True)),
        terms_accepted=bool(body.get("terms_accepted", True)),
        ai_notice_accepted=bool(body.get("ai_notice_accepted", True)),
        personal_data_consent_accepted=bool(body.get("personal_data_consent_accepted", False)),
        special_category_consent_accepted=bool(body.get("special_category_consent_accepted", False)),
        parental_responsibility_confirmed=bool(body.get("parental_responsibility_confirmed", False)),
        recorded_by_user_id=user_id,
    )
    _log_audit_event(
        user_id=user_id,
        action="parental_consent.record",
        resource_type="parental_consent",
        resource_id=consent["id"],
        child_id=child_id,
        metadata={"guardian_email": guardian_email},
    )
    return jsonify(consent), 201


@app.route(API_CHILD_DATA_EXPORT_ENDPOINT, methods=["POST"])
def export_child_data(child_id: str):
    """Export all data for a child as JSON (SAR / data portability)."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_LEARNER},
    )
    if guard_response is not None:
        return guard_response

    body = request.get_json(silent=True) or {}
    if not body.get("confirm"):
        return jsonify({"error": "Set confirm=true to export child data"}), 400
    reason = str(body.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "A reason is required for data export"}), 400

    data = storage_service.export_child_data(child_id)
    if not data:
        return jsonify({"error": "Child not found"}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.data_export",
        resource_type="child",
        resource_id=child_id,
        child_id=child_id,
        metadata={"reason": reason},
    )
    return jsonify(data)


@app.route(API_CHILD_DATA_DELETE_ENDPOINT, methods=["DELETE"])
def delete_child_data(child_id: str):
    """Permanently delete all data for a child (right to erasure)."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_LEARNER},
    )
    if guard_response is not None:
        return guard_response

    body = request.get_json(silent=True) or {}
    if not body.get("confirm"):
        return jsonify({"error": "Set confirm=true to permanently delete all child data"}), 400

    user_id = str(cast(Dict[str, Any], user).get("id"))
    _log_audit_event(
        user_id=user_id,
        action="child.data_delete",
        resource_type="child",
        resource_id=child_id,
        child_id=child_id,
    )

    deleted = storage_service.delete_child_data(child_id)
    if not deleted:
        return jsonify({"error": "Child not found"}), HTTP_NOT_FOUND

    return jsonify({"deleted": True, "child_id": child_id})


@app.route(API_SCENARIOS_ENDPOINT)
def get_scenarios():
    """Get list of available scenarios."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    return jsonify(scenario_manager.list_scenarios())


@app.route(f"{API_SCENARIOS_ENDPOINT}/<scenario_id>")
def get_scenario(scenario_id: str):
    """Get a specific scenario by ID."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    scenario = scenario_manager.get_scenario(scenario_id)
    if scenario:
        return jsonify(scenario)
    return jsonify({"error": SCENARIO_NOT_FOUND}), HTTP_NOT_FOUND


@app.route(API_CHILDREN_ENDPOINT, methods=["GET", "POST"])
def get_children():
    """Return the available child profiles for therapist-guided sessions."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    if request.method == "POST":
        if str(cast(Dict[str, Any], user).get("role") or "") not in {ROLE_THERAPIST, ROLE_ADMIN}:
            return jsonify({"error": "Therapist role required"}), HTTP_FORBIDDEN

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        name = str(data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), HTTP_BAD_REQUEST

        workspace_id = str(data.get("workspace_id") or "").strip() or None

        try:
            child = storage_service.create_child(
                name=name,
                created_by_user_id=str(cast(Dict[str, Any], user).get("id")),
                relationship="therapist",
                date_of_birth=str(data.get("date_of_birth") or "").strip() or None,
                notes=str(data.get("notes") or "").strip() or None,
                workspace_id=workspace_id,
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), HTTP_FORBIDDEN
        _log_audit_event(
            user_id=str(cast(Dict[str, Any], user).get("id")),
            action="child.create",
            resource_type="child",
            resource_id=str(child.get("id")),
            child_id=str(child.get("id")),
            metadata={"workspace_id": child.get("workspace_id")},
        )
        return jsonify(child), 201

    user_id = str(cast(Dict[str, Any], user).get("id"))
    workspace_id_filter = request.args.get("workspace_id") or None
    children = storage_service.list_children_for_user(user_id, workspace_id=workspace_id_filter)
    _log_audit_event(
        user_id=user_id,
        action="child.list",
        resource_type="child_collection",
        resource_id=user_id,
        metadata={"count": len(children)},
    )
    return jsonify(children)


@app.route(API_CHILD_DETAIL_ENDPOINT, methods=["DELETE"])
def delete_child(child_id: str):
    """Soft-delete a child profile when the caller is an owning parent or admin."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_PARENT, ROLE_ADMIN},
        allowed_relationships=["parent"],
    )
    if guard_response is not None:
        return guard_response

    child = storage_service.soft_delete_child(child_id)
    if child is None:
        return jsonify({"error": "Child not found"}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.soft_delete",
        resource_type="child",
        resource_id=child_id,
        child_id=child_id,
    )
    return jsonify(child)


@app.route(API_INVITATIONS_ENDPOINT, methods=["GET", "POST"])
def child_invitations():
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    if request.method == "POST":
        therapist_user, therapist_guard = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
        if therapist_guard is not None:
            return therapist_guard

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        child_id = str(data.get("child_id") or "").strip()
        invited_email = str(data.get("invited_email") or "").strip().lower()
        relationship = str(data.get("relationship") or ROLE_PARENT).strip().lower()
        if not child_id:
            return jsonify({"error": "child_id is required"}), HTTP_BAD_REQUEST
        if not invited_email:
            return jsonify({"error": "invited_email is required"}), HTTP_BAD_REQUEST

        child_user, child_guard = _require_child_access(
            child_id,
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
        )
        if child_guard is not None:
            return child_guard

        try:
            invitation = storage_service.create_child_invitation(
                child_id=child_id,
                invited_email=invited_email,
                relationship=relationship,
                invited_by_user_id=str(cast(Dict[str, Any], child_user).get("id")),
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

        email_delivery = _send_invitation_email(
            invitation,
            inviter_name=str(cast(Dict[str, Any], child_user).get("name") or "Your therapist"),
        )
        _persist_invitation_email_delivery(str(invitation.get("id") or ""), email_delivery)

        _log_audit_event(
            user_id=str(cast(Dict[str, Any], child_user).get("id")),
            action="child.invitation.create",
            resource_type="child_invitation",
            resource_id=str(invitation.get("id")),
            child_id=child_id,
            metadata={
                "invited_email": invited_email,
                "relationship": relationship,
                "email_delivery": email_delivery,
            },
        )
        return jsonify({**invitation, "email_delivery": email_delivery}), 201

    invitations = storage_service.list_child_invitations_for_user(
        str(cast(Dict[str, Any], user).get("id")),
        str(cast(Dict[str, Any], user).get("email") or ""),
    )
    return jsonify(invitations)


@app.route(API_INVITATION_ACCEPT_ENDPOINT, methods=["POST"])
def accept_child_invitation(invitation_id: str):
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        invitation = storage_service.respond_to_child_invitation(
            invitation_id,
            user_id=str(cast(Dict[str, Any], user).get("id")),
            user_email=str(cast(Dict[str, Any], user).get("email") or ""),
            accept=True,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.invitation.accept",
        resource_type="child_invitation",
        resource_id=invitation_id,
        child_id=str(invitation.get("child_id") or "") or None,
    )
    return jsonify(invitation)


@app.route(API_INVITATION_DECLINE_ENDPOINT, methods=["POST"])
def decline_child_invitation(invitation_id: str):
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        invitation = storage_service.respond_to_child_invitation(
            invitation_id,
            user_id=str(cast(Dict[str, Any], user).get("id")),
            user_email=str(cast(Dict[str, Any], user).get("email") or ""),
            accept=False,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.invitation.decline",
        resource_type="child_invitation",
        resource_id=invitation_id,
        child_id=str(invitation.get("child_id") or "") or None,
    )
    return jsonify(invitation)


@app.route(API_INVITATION_REVOKE_ENDPOINT, methods=["POST"])
def revoke_child_invitation(invitation_id: str):
    user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    existing_invitation = storage_service.get_child_invitation(invitation_id)
    if existing_invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    is_admin = str(cast(Dict[str, Any], user).get("role") or "") == ROLE_ADMIN
    if not is_admin and str(existing_invitation.get("invited_by_user_id") or "") != str(
        cast(Dict[str, Any], user).get("id") or ""
    ):
        return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN

    invitation = storage_service.revoke_child_invitation(invitation_id)
    if invitation is None:
        return jsonify({"error": "Invitation is no longer pending"}), HTTP_BAD_REQUEST

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.invitation.revoke",
        resource_type="child_invitation",
        resource_id=invitation_id,
        child_id=str(invitation.get("child_id") or "") or None,
    )
    return jsonify(invitation)


@app.route(API_INVITATION_RESEND_ENDPOINT, methods=["POST"])
def resend_child_invitation(invitation_id: str):
    user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    existing_invitation = storage_service.get_child_invitation(invitation_id)
    if existing_invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    is_admin = str(cast(Dict[str, Any], user).get("role") or "") == ROLE_ADMIN
    if not is_admin and str(existing_invitation.get("invited_by_user_id") or "") != str(
        cast(Dict[str, Any], user).get("id") or ""
    ):
        return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN

    invitation = storage_service.resend_child_invitation(invitation_id)
    if invitation is None:
        return jsonify({"error": "Invitation cannot be resent"}), HTTP_BAD_REQUEST

    email_delivery = _send_invitation_email(
        invitation,
        inviter_name=str(
            existing_invitation.get("invited_by_name") or cast(Dict[str, Any], user).get("name") or "Your therapist"
        ),
    )
    _persist_invitation_email_delivery(str(invitation.get("id") or ""), email_delivery)

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="child.invitation.resend",
        resource_type="child_invitation",
        resource_id=invitation_id,
        child_id=str(invitation.get("child_id") or "") or None,
        metadata={"email_delivery": email_delivery},
    )
    return jsonify({**invitation, "email_delivery": email_delivery})


@app.route(API_FAMILY_INTAKE_INVITATIONS_ENDPOINT, methods=["GET", "POST"])
def family_intake_invitations():
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")
    user_email = str(cast(Dict[str, Any], user).get("email") or "")

    if request.method == "POST":
        therapist_user, therapist_guard = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
        if therapist_guard is not None:
            return therapist_guard

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        invited_email = str(data.get("invited_email") or "").strip().lower()
        workspace_id = str(data.get("workspace_id") or "").strip()
        if not invited_email:
            return jsonify({"error": "invited_email is required"}), HTTP_BAD_REQUEST

        if not workspace_id:
            default_workspace = storage_service.get_default_workspace_for_user(user_id)
            workspace_id = str(default_workspace.get("id") or "") if default_workspace else ""

        if not workspace_id:
            return jsonify({"error": "workspace_id is required"}), HTTP_BAD_REQUEST

        try:
            invitation = storage_service.create_family_intake_invitation(
                invited_email=invited_email,
                invited_by_user_id=user_id,
                workspace_id=workspace_id,
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

        email_delivery = _send_family_intake_invitation_email(
            invitation,
            inviter_name=str(cast(Dict[str, Any], therapist_user).get("name") or "Your therapist"),
        )

        _log_audit_event(
            user_id=user_id,
            action="family_intake.invitation.create",
            resource_type="family_intake_invitation",
            resource_id=str(invitation.get("id") or ""),
            metadata={
                "workspace_id": workspace_id,
                "invited_email": invited_email,
                "email_delivery": email_delivery,
            },
        )
        return jsonify({**invitation, "email_delivery": email_delivery}), HTTP_CREATED

    invitations = storage_service.list_family_intake_invitations_for_user(user_id, user_email)
    return jsonify(invitations)


@app.route(API_FAMILY_INTAKE_INVITATION_ACCEPT_ENDPOINT, methods=["POST"])
def accept_family_intake_invitation(invitation_id: str):
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        invitation = storage_service.respond_to_family_intake_invitation(
            invitation_id,
            user_id=str(cast(Dict[str, Any], user).get("id") or ""),
            user_email=str(cast(Dict[str, Any], user).get("email") or ""),
            accept=True,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id") or ""),
        action="family_intake.invitation.accept",
        resource_type="family_intake_invitation",
        resource_id=invitation_id,
        metadata={"workspace_id": invitation.get("workspace_id")},
    )
    return jsonify(invitation)


@app.route(API_FAMILY_INTAKE_INVITATION_DECLINE_ENDPOINT, methods=["POST"])
def decline_family_intake_invitation(invitation_id: str):
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        invitation = storage_service.respond_to_family_intake_invitation(
            invitation_id,
            user_id=str(cast(Dict[str, Any], user).get("id") or ""),
            user_email=str(cast(Dict[str, Any], user).get("email") or ""),
            accept=False,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if invitation is None:
        return jsonify({"error": INVITATION_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id") or ""),
        action="family_intake.invitation.decline",
        resource_type="family_intake_invitation",
        resource_id=invitation_id,
        metadata={"workspace_id": invitation.get("workspace_id")},
    )
    return jsonify(invitation)


@app.route(API_FAMILY_INTAKE_PROPOSALS_ENDPOINT, methods=["GET", "POST"])
def family_intake_proposals():
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    user_id = str(cast(Dict[str, Any], user).get("id") or "")

    if request.method == "POST":
        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        invitation_id = str(data.get("family_intake_invitation_id") or "").strip()
        proposals = data.get("children")
        if not invitation_id:
            return jsonify({"error": "family_intake_invitation_id is required"}), HTTP_BAD_REQUEST
        if not isinstance(proposals, list) or not proposals:
            return jsonify({"error": "At least one child proposal is required"}), HTTP_BAD_REQUEST

        try:
            created = storage_service.create_child_intake_proposals(
                family_intake_invitation_id=invitation_id,
                created_by_user_id=user_id,
                proposals=cast(List[Dict[str, Any]], proposals),
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

        _log_audit_event(
            user_id=user_id,
            action="family_intake.proposals.create",
            resource_type="child_intake_proposal_batch",
            resource_id=invitation_id,
            metadata={"proposal_count": len(created)},
        )
        return jsonify(created), HTTP_CREATED

    proposals = storage_service.list_child_intake_proposals_for_user(user_id)
    return jsonify(proposals)


@app.route(API_FAMILY_INTAKE_PENDING_PROPOSALS_ENDPOINT)
def pending_family_intake_proposals():
    user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    workspace_id = str(request.args.get("workspace_id") or "").strip() or None
    proposals = storage_service.list_pending_child_intake_proposals(workspace_id=workspace_id)
    return jsonify(proposals)


@app.route(API_FAMILY_INTAKE_PROPOSAL_APPROVE_ENDPOINT, methods=["POST"])
def approve_family_intake_proposal(proposal_id: str):
    user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    review_note = str(data.get("review_note") or "").strip() or None

    try:
        proposal = storage_service.approve_child_intake_proposal(
            proposal_id,
            reviewed_by_user_id=str(cast(Dict[str, Any], user).get("id") or ""),
            review_note=review_note,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if proposal is None:
        return jsonify({"error": "Child intake proposal not found"}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id") or ""),
        action="family_intake.proposal.approve",
        resource_type="child_intake_proposal",
        resource_id=proposal_id,
        child_id=str(proposal.get("final_child_id") or "") or None,
        metadata={"workspace_id": proposal.get("workspace_id")},
    )
    return jsonify(proposal)


@app.route(API_FAMILY_INTAKE_PROPOSAL_REJECT_ENDPOINT, methods=["POST"])
def reject_family_intake_proposal(proposal_id: str):
    user, guard_response = _require_role(ROLE_THERAPIST, ROLE_ADMIN)
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    review_note = str(data.get("review_note") or "").strip() or None

    try:
        proposal = storage_service.reject_child_intake_proposal(
            proposal_id,
            reviewed_by_user_id=str(cast(Dict[str, Any], user).get("id") or ""),
            review_note=review_note,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if proposal is None:
        return jsonify({"error": "Child intake proposal not found"}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id") or ""),
        action="family_intake.proposal.reject",
        resource_type="child_intake_proposal",
        resource_id=proposal_id,
        metadata={"workspace_id": proposal.get("workspace_id")},
    )
    return jsonify(proposal)


@app.route(API_FAMILY_INTAKE_PROPOSAL_RESUBMIT_ENDPOINT, methods=["POST"])
def resubmit_family_intake_proposal(proposal_id: str):
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    child_name = str(data.get("child_name") or "").strip()
    date_of_birth = str(data.get("date_of_birth") or "").strip() or None
    notes = str(data.get("notes") or "").strip() or None
    if not child_name:
        return jsonify({"error": "child_name is required"}), HTTP_BAD_REQUEST

    try:
        proposal = storage_service.resubmit_child_intake_proposal(
            proposal_id,
            created_by_user_id=str(cast(Dict[str, Any], user).get("id") or ""),
            child_name=child_name,
            date_of_birth=date_of_birth,
            notes=notes,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    if proposal is None:
        return jsonify({"error": "Child intake proposal not found"}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id") or ""),
        action="family_intake.proposal.resubmit",
        resource_type="child_intake_proposal",
        resource_id=proposal_id,
        metadata={"workspace_id": proposal.get("workspace_id")},
    )
    return jsonify(proposal)


@app.route(API_AGENTS_CREATE_ENDPOINT, methods=["POST"])
def create_agent():
    """Create a new agent for a scenario.

    Supports two modes:
    1. Server-side scenario: Pass scenario_id to use a pre-defined scenario
    2. Custom scenario: Pass custom_scenario with full scenario data (for client-side scenarios)
    """
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    scenario_id = data.get("scenario_id")
    custom_scenario = data.get("custom_scenario")
    avatar_config = data.get("avatar")
    child_id = str(data.get("child_id") or "").strip() or None

    if child_id:
        _, child_guard = _require_child_access(child_id)
        if child_guard is not None:
            return child_guard
        safety_guard = _enforce_voice_safety_for_child(child_id)
        if safety_guard is not None:
            return safety_guard

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
        runtime_personalization = (
            child_memory_service.build_live_session_personalization(child_id) if child_id else None
        )
        agent_id = agent_manager.create_agent(
            scenario_id,
            scenario,
            avatar_config,
            runtime_personalization=runtime_personalization,
        )

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
        _log_audit_event(
            user_id=str(cast(Dict[str, Any], user).get("id")),
            action="session.start",
            resource_type="child_session",
            resource_id=agent_id,
            child_id=child_id,
            metadata={"scenario_id": str(scenario_id)},
        )
        return jsonify(
            {
                "agent_id": agent_id,
                "scenario_id": scenario_id,
                "runtime_personalization": runtime_personalization,
            }
        )
    except Exception as e:
        logger.error("Failed to create agent: %s", e)
        return jsonify({"error": str(e)}), HTTP_INTERNAL_SERVER_ERROR


@app.route("/api/agents/<agent_id>", methods=["DELETE"])
def delete_agent(agent_id: str):
    """Delete an agent."""
    user, guard_response = _require_authenticated()
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
    user, guard_response = _require_authenticated()
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

    if not child_id:
        return jsonify({"error": "child_id is required"}), HTTP_BAD_REQUEST

    _, child_guard = _require_child_access(child_id)
    if child_guard is not None:
        return child_guard

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
        _log_audit_event(
            user_id=str(cast(Dict[str, Any], user).get("id")),
            action="session.create",
            resource_type="session",
            resource_id=session_id,
            child_id=child_id,
            metadata={"scenario_id": scenario_id},
        )
        synthesis_started = time.perf_counter()
        try:
            memory_result = child_memory_service.synthesize_session_memory(session_id)
            synthesis_duration_ms = round((time.perf_counter() - synthesis_started) * 1000, 2)
            telemetry_service.track_event(
                "child_memory_synthesized",
                properties={
                    "session_id": session_id,
                    "child_id": memory_result.get("child_id"),
                },
                measurements={
                    "duration_ms": synthesis_duration_ms,
                    "pending_proposals": float(len(cast(List[Dict[str, Any]], memory_result.get("proposals") or []))),
                    "auto_applied_items": float(
                        len(cast(List[Dict[str, Any]], memory_result.get("auto_applied_items") or []))
                    ),
                },
            )
            if synthesis_duration_ms > 750:
                logger.warning(
                    "Child memory synthesis for session %s took %.2fms",
                    session_id,
                    synthesis_duration_ms,
                )
        except Exception:
            logger.exception("Child memory synthesis failed for session %s", session_id)
            telemetry_service.track_event(
                "child_memory_synthesis_failed",
                properties={"session_id": session_id},
                measurements={"duration_ms": round((time.perf_counter() - synthesis_started) * 1000, 2)},
            )

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
    """Synthesize a short text / phoneme / SSML payload using Azure AI Speech.

    Accepted JSON bodies (mutually exclusive on input mode):

    - ``{"text": "..."}`` — plain text, <= 200 chars
    - ``{"ssml": "<speak>...</speak>"}`` — caller-built SSML document, <= 2000 chars
    - ``{"phoneme": "θ", "alphabet": "ipa", "fallback_text": "sound"}`` —
      server builds an SSML document wrapping ``<phoneme alphabet="ipa" ph="...">``

    Optional ``voice_name`` override is honoured when the value is a
    non-empty string; otherwise the configured default voice is used.
    """
    _, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})

    text = cast(str, data.get("text") or "").strip()
    ssml = cast(str, data.get("ssml") or "").strip()
    phoneme = cast(str, data.get("phoneme") or "").strip()
    alphabet = cast(str, data.get("alphabet") or "ipa").strip() or "ipa"
    fallback_text = cast(str, data.get("fallback_text") or "sound").strip() or "sound"

    mode_count = sum(1 for value in (text, ssml, phoneme) if value)
    if mode_count == 0:
        return jsonify({"error": "text, ssml, or phoneme is required"}), HTTP_BAD_REQUEST
    if mode_count > 1:
        return (
            jsonify({"error": "provide exactly one of text, ssml, or phoneme"}),
            HTTP_BAD_REQUEST,
        )

    if text and len(text) > 200:
        return jsonify({"error": "text is required (max 200 chars)"}), HTTP_BAD_REQUEST
    if ssml and len(ssml) > 2000:
        return jsonify({"error": "ssml too long (max 2000 chars)"}), HTTP_BAD_REQUEST
    if phoneme and len(phoneme) > 32:
        return jsonify({"error": "phoneme too long (max 32 chars)"}), HTTP_BAD_REQUEST

    default_voice = cast(str, config["azure_voice_name"])
    requested_voice = cast(str, data.get("voice_name") or "").strip()
    voice_name = requested_voice or default_voice

    speech_key = config["azure_speech_key"]
    speech_region = config["azure_speech_region"]

    if not speech_key:
        return jsonify({"error": "Speech service not configured"}), HTTP_INTERNAL_SERVER_ERROR

    def _escape_xml(value: str) -> str:
        return (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    synthesis_ssml: Optional[str] = None
    synthesis_text: Optional[str] = None
    if ssml:
        synthesis_ssml = ssml
    elif phoneme:
        synthesis_ssml = (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">'
            f'<voice name="{_escape_xml(voice_name)}">'
            f'<phoneme alphabet="{_escape_xml(alphabet)}" ph="{_escape_xml(phoneme)}">'
            f"{_escape_xml(fallback_text)}"
            "</phoneme>"
            "</voice>"
            "</speak>"
        )
    else:
        synthesis_text = text

    try:
        import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]

        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        speech_config.speech_synthesis_voice_name = voice_name
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3
        )
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        if synthesis_ssml is not None:
            result = synthesizer.speak_ssml_async(synthesis_ssml).get()
        else:
            assert synthesis_text is not None
            result = synthesizer.speak_text_async(synthesis_text).get()

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
    user, guard_response = _require_child_access(child_id, enforce_data_consent=True)
    if guard_response is not None:
        return guard_response

    sessions = storage_service.list_sessions_for_child(child_id)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="session.list",
        resource_type="session_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(sessions)},
    )
    return jsonify(sessions)


@app.route(API_CHILD_PLANS_ENDPOINT)
def get_child_plans(child_id: str):
    """Return saved practice plans for one child."""
    user, guard_response = _require_child_access(child_id, enforce_data_consent=True)
    if guard_response is not None:
        return guard_response

    plans = storage_service.list_practice_plans_for_child(child_id)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="plan.list",
        resource_type="plan_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(plans)},
    )
    return jsonify(plans)


@app.route(API_CHILD_MEMORY_SUMMARY_ENDPOINT)
def get_child_memory_summary(child_id: str):
    """Return the compiled child memory summary for therapist review."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
        enforce_data_consent=True,
    )
    if guard_response is not None:
        return guard_response

    summary = child_memory_service.get_child_memory_summary(child_id)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="memory.summary.read",
        resource_type="child_memory_summary",
        resource_id=child_id,
        child_id=child_id,
    )
    return jsonify(summary)


@app.route(API_CHILD_MEMORY_ITEMS_ENDPOINT, methods=["GET", "POST"])
def child_memory_items(child_id: str):
    """Return or create child memory items for therapist review workflows."""
    if request.method == "POST":
        therapist_user, therapist_guard = _require_child_access(
            child_id,
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
            enforce_data_consent=True,
        )
        if therapist_guard is not None:
            return therapist_guard

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        statement = str(data.get("statement") or "").strip()
        if not statement:
            return jsonify({"error": "statement is required"}), HTTP_BAD_REQUEST

        try:
            result = child_memory_service.create_manual_item(
                child_id=child_id,
                category=str(data.get("category") or "general").strip() or "general",
                statement=statement,
                therapist_user_id=str(cast(Dict[str, Any], therapist_user).get("id")),
                memory_type=str(data.get("memory_type") or "fact").strip() or "fact",
                detail=cast(Optional[Dict[str, Any]], data.get("detail") or None),
                confidence=cast(Optional[float], data.get("confidence")),
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

        _log_audit_event(
            user_id=str(cast(Dict[str, Any], therapist_user).get("id")),
            action="memory.item.create",
            resource_type="child_memory_item",
            resource_id=str(cast(Dict[str, Any], cast(Dict[str, Any], result).get("item") or {}).get("id") or child_id),
            child_id=child_id,
        )
        return jsonify(result), 201

    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
        enforce_data_consent=True,
    )
    if guard_response is not None:
        return guard_response

    status = str(request.args.get("status") or "").strip() or None
    category = str(request.args.get("category") or "").strip() or None
    include_evidence = str(request.args.get("include_evidence") or "").strip().lower() in {"1", "true", "yes"}
    items = child_memory_service.list_child_memory_items(
        child_id,
        status=status,
        category=category,
        include_evidence=include_evidence,
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="memory.item.list",
        resource_type="child_memory_item_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(items)},
    )
    return jsonify(items)


@app.route(API_CHILD_MEMORY_PROPOSALS_ENDPOINT)
def get_child_memory_proposals(child_id: str):
    """Return child memory proposals, optionally filtered by status or category."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
        enforce_data_consent=True,
    )
    if guard_response is not None:
        return guard_response

    status = str(request.args.get("status") or "").strip() or None
    category = str(request.args.get("category") or "").strip() or None
    include_evidence = str(request.args.get("include_evidence") or "").strip().lower() in {"1", "true", "yes"}
    proposals = child_memory_service.list_child_memory_proposals(
        child_id,
        status=status,
        category=category,
        include_evidence=include_evidence,
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="memory.proposal.list",
        resource_type="child_memory_proposal_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(proposals)},
    )
    return jsonify(proposals)


@app.route(API_INSTITUTIONAL_MEMORY_INSIGHTS_ENDPOINT)
def get_institutional_memory_insights():
    """Return the de-identified clinic-level institutional memory snapshot for therapists."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    refresh = str(request.args.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
    snapshot = institutional_memory_service.get_snapshot(str(cast(Dict[str, Any], user).get("id")), refresh=refresh)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="institutional_memory.read",
        resource_type="institutional_memory_snapshot",
        resource_id=str(cast(Dict[str, Any], user).get("id")),
    )
    return jsonify(snapshot)


@app.route("/api/insights/ask", methods=["POST"])
def post_insights_ask():
    """Run a single Insights Agent turn for a therapist and persist the exchange."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    scope_raw = payload.get("scope") or {"type": "caseload"}
    if not isinstance(scope_raw, dict):
        return jsonify({"error": "scope must be an object"}), 400

    conversation_id = payload.get("conversation_id")
    conversation_id = str(conversation_id).strip() if conversation_id else None

    user_id = str(cast(Dict[str, Any], user).get("id"))

    # If the scope names a child, enforce route-level access on top of the
    # service's own check so we return the standard 403 shape.
    scope_child_id = scope_raw.get("child_id")
    if scope_child_id:
        _, child_guard = _require_child_access(
            str(scope_child_id),
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
        )
        if child_guard is not None:
            return child_guard

    try:
        result = insights_service.ask(
            user_id=user_id,
            message=message,
            scope=scope_raw,
            conversation_id=conversation_id,
        )
    except InsightsAuthorizationError as exc:
        return jsonify({"error": str(exc)}), HTTP_FORBIDDEN
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    _log_audit_event(
        user_id=user_id,
        action="insights.ask",
        resource_type="insight_conversation",
        resource_id=str(result["conversation"]["id"]),
        child_id=str(scope_child_id) if scope_child_id else None,
        metadata={
            "tool_calls_count": result.get("tool_calls_count"),
            "latency_ms": result.get("latency_ms"),
            "scope_type": scope_raw.get("type"),
        },
    )
    return jsonify(result)


@app.route("/api/chat/ask", methods=["POST"])
def post_chat_ask():
    """Text-mode chat endpoint. Thin wrapper over ``insights_service.ask`` that
    returns a flat envelope tailored for the chat UI."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    scope_raw = payload.get("scope") or {"type": "caseload"}
    if not isinstance(scope_raw, dict):
        return jsonify({"error": "scope must be an object"}), 400

    conversation_id = payload.get("conversation_id")
    conversation_id = str(conversation_id).strip() if conversation_id else None

    user_id = str(cast(Dict[str, Any], user).get("id"))

    scope_child_id = scope_raw.get("child_id")
    if scope_child_id:
        _, child_guard = _require_child_access(
            str(scope_child_id),
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
        )
        if child_guard is not None:
            return child_guard

    request_id = uuid.uuid4().hex

    try:
        result = insights_service.ask(
            user_id=user_id,
            message=message,
            scope=scope_raw,
            conversation_id=conversation_id,
            request_id=request_id,
        )
    except InsightsAuthorizationError as exc:
        return jsonify({"error": str(exc)}), HTTP_FORBIDDEN
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001 - boundary handler returns 500 envelope
        logger.exception("[chat-api] planner failed request_id=%s", request_id)
        return (
            jsonify({"error": "planner_failed", "error_text": str(exc), "request_id": request_id}),
            500,
        )

    assistant = result.get("assistant_message") or {}
    conversation = result.get("conversation") or {}

    flat = {
        "conversation_id": str(conversation.get("id") or ""),
        "request_id": request_id,
        "answer_text": assistant.get("content_text") or "",
        "citations": assistant.get("citations") or [],
        "visualizations": assistant.get("visualizations") or [],
        "ui_specs": assistant.get("ui_specs") or [],
        "action_suggestions": assistant.get("action_suggestions") or [],
        "route": result.get("route"),
        "cached": bool(result.get("cached")),
        "latency_ms": int(result.get("latency_ms") or 0),
        "tool_calls_count": int(result.get("tool_calls_count") or 0),
        "error_text": assistant.get("error_text"),
    }

    _log_audit_event(
        user_id=user_id,
        action="chat.ask",
        resource_type="insight_conversation",
        resource_id=flat["conversation_id"],
        child_id=str(scope_child_id) if scope_child_id else None,
        metadata={
            "tool_calls_count": flat["tool_calls_count"],
            "latency_ms": flat["latency_ms"],
            "scope_type": scope_raw.get("type"),
            "route": flat["route"],
            "request_id": request_id,
        },
    )
    return jsonify(flat)


def _sse_frame(event: str, data: Dict[str, Any]) -> str:
    """Serialise a single Server-Sent Event frame.

    We emit both ``event:`` (so EventSource-style consumers can dispatch) and
    a JSON ``data:`` line. Each frame is terminated by a blank line per the
    SSE spec.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


@app.route("/api/chat/stream", methods=["POST"])
def post_chat_stream():
    """SSE chat endpoint. Same inputs and authorisation as ``/api/chat/ask``;
    response is a single ``text/event-stream`` of typed frames:

    * ``meta``      — request_id, prompt_version (sent immediately so the UI
                      can show a "thinking" caret).
    * ``token``     — incremental answer text. The current backend emits the
                      full answer in one frame; this contract leaves room for
                      true per-token streaming behind the same wire shape.
    * ``artifacts`` — citations, visualizations, ui_specs, action_suggestions.
    * ``done``      — terminal frame with conversation_id, message_id,
                      latency_ms, tool_calls_count, route, cached, error_text.
    * ``error``     — terminal error frame (HTTP status is still 200 once
                      the stream is open).

    Guards run BEFORE any bytes are written so authn/authz failures still
    surface as proper HTTP errors. When ``CHAT_STREAM_ENABLED=false`` the
    route returns 404 and the UI falls back to ``/api/chat/ask``.
    """
    if not app.config.get("chat_stream_enabled", True):
        return ("", 404)

    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    scope_raw = payload.get("scope") or {"type": "caseload"}
    if not isinstance(scope_raw, dict):
        return jsonify({"error": "scope must be an object"}), 400

    conversation_id_input = payload.get("conversation_id")
    conversation_id_input = (
        str(conversation_id_input).strip() if conversation_id_input else None
    )

    user_id = str(cast(Dict[str, Any], user).get("id"))

    scope_child_id = scope_raw.get("child_id")
    if scope_child_id:
        _, child_guard = _require_child_access(
            str(scope_child_id),
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
        )
        if child_guard is not None:
            return child_guard

    request_id = uuid.uuid4().hex
    stream_started_at = time.perf_counter()

    def generate():
        # Per-stream telemetry. ``outcome`` is updated as we progress; the
        # ``finally`` block emits one structured log line on terminate
        # regardless of whether the stream completed, errored, or the client
        # disconnected mid-flight (which surfaces as ``GeneratorExit``).
        counters = {"frames_emitted": 0, "bytes_emitted": 0, "ttfb_ms": None}
        # Default to ``disconnected`` so a client that drops between yields
        # is recorded correctly — completion/error paths overwrite this.
        outcome = {"value": "disconnected", "code": None, "conversation_id": None}

        def emit(event: str, data: Dict[str, Any]) -> str:
            frame = _sse_frame(event, data)
            counters["frames_emitted"] += 1
            counters["bytes_emitted"] += len(frame)
            if counters["ttfb_ms"] is None:
                counters["ttfb_ms"] = round(
                    (time.perf_counter() - stream_started_at) * 1000, 1
                )
            return frame

        try:
            # First byte: tell the client the stream is alive so it can show
            # the thinking caret without waiting for the planner to return.
            yield emit(
                "meta",
                {
                    "conversation_id": conversation_id_input,
                    "request_id": request_id,
                    "prompt_version": "chat-v1",
                },
            )

            try:
                stream_iter = insights_service.ask_stream(
                    user_id=user_id,
                    message=message,
                    scope=scope_raw,
                    conversation_id=conversation_id_input,
                    request_id=request_id,
                )
            except InsightsAuthorizationError as exc:
                outcome["value"] = "error"
                outcome["code"] = "forbidden"
                yield emit(
                    "error",
                    {
                        "code": "forbidden",
                        "message": str(exc),
                        "request_id": request_id,
                        "retryable": False,
                    },
                )
                return
            except ValueError as exc:
                outcome["value"] = "error"
                outcome["code"] = "invalid"
                yield emit(
                    "error",
                    {
                        "code": "invalid",
                        "message": str(exc),
                        "request_id": request_id,
                        "retryable": False,
                    },
                )
                return
            except Exception as exc:  # noqa: BLE001 - boundary handler
                outcome["value"] = "error"
                outcome["code"] = "planner_failed"
                logger.exception(
                    "[chat-stream] planner failed request_id=%s", request_id
                )
                yield emit(
                    "error",
                    {
                        "code": "planner_failed",
                        "message": str(exc),
                        "request_id": request_id,
                        "retryable": True,
                    },
                )
                return

            # Consume the streaming iterator: prose deltas become ``token``
            # frames, the final dict drives ``artifacts`` + ``done``. Errors
            # raised by ``ask_stream`` after the first delta are converted
            # into a final payload with ``error_text`` by the service, so we
            # don't need a second exception net here.
            result: Optional[Dict[str, Any]] = None
            try:
                for kind, payload in stream_iter:
                    if kind == "delta":
                        if payload:
                            yield emit("token", {"delta": str(payload)})
                    elif kind == "final":
                        result = payload if isinstance(payload, dict) else None
                        break
            except InsightsAuthorizationError as exc:
                outcome["value"] = "error"
                outcome["code"] = "forbidden"
                yield emit(
                    "error",
                    {
                        "code": "forbidden",
                        "message": str(exc),
                        "request_id": request_id,
                        "retryable": False,
                    },
                )
                return
            except Exception as exc:  # noqa: BLE001 - boundary handler
                outcome["value"] = "error"
                outcome["code"] = "planner_failed"
                logger.exception(
                    "[chat-stream] planner streaming failed request_id=%s",
                    request_id,
                )
                yield emit(
                    "error",
                    {
                        "code": "planner_failed",
                        "message": str(exc),
                        "request_id": request_id,
                        "retryable": True,
                    },
                )
                return

            if result is None:
                outcome["value"] = "error"
                outcome["code"] = "planner_failed"
                yield emit(
                    "error",
                    {
                        "code": "planner_failed",
                        "message": "stream ended without a final result",
                        "request_id": request_id,
                        "retryable": True,
                    },
                )
                return

            assistant = result.get("assistant_message") or {}
            conversation = result.get("conversation") or {}
            conv_id = str(conversation.get("id") or "")
            outcome["conversation_id"] = conv_id or None
            latency_ms = int(result.get("latency_ms") or 0)
            tool_calls_count = int(result.get("tool_calls_count") or 0)
            route = result.get("route")

            # Write audit BEFORE the remaining yields. If the client has already
            # disconnected, the audit log still persists; the assistant turn is
            # already persisted inside ``insights_service.ask_stream``.
            _log_audit_event(
                user_id=user_id,
                action="chat.ask",
                resource_type="insight_conversation",
                resource_id=conv_id,
                child_id=str(scope_child_id) if scope_child_id else None,
                metadata={
                    "tool_calls_count": tool_calls_count,
                    "latency_ms": latency_ms,
                    "scope_type": scope_raw.get("type"),
                    "route": route,
                    "request_id": request_id,
                    "transport": "sse",
                },
            )

            yield emit(
                "artifacts",
                {
                    "citations": assistant.get("citations") or [],
                    "visualizations": assistant.get("visualizations") or [],
                    "ui_specs": assistant.get("ui_specs") or [],
                    "action_suggestions": assistant.get("action_suggestions") or [],
                },
            )

            yield emit(
                "done",
                {
                    "conversation_id": conv_id,
                    "message_id": str(assistant.get("id") or ""),
                    "latency_ms": latency_ms,
                    "tool_calls_count": tool_calls_count,
                    "route": route,
                    "cached": bool(result.get("cached")),
                    "error_text": assistant.get("error_text"),
                },
            )
            outcome["value"] = "completed"
            # Cached vs live route is the most useful split for the done outcome.
            outcome["code"] = "cached" if result.get("cached") else (route or "live")
        finally:
            total_ms = round((time.perf_counter() - stream_started_at) * 1000, 1)
            logger.info(
                "[chat-stream-telemetry] %s",
                json.dumps(
                    {
                        "request_id": request_id,
                        "conversation_id": outcome["conversation_id"],
                        "outcome": outcome["value"],
                        "outcome_code": outcome["code"],
                        "frames_emitted": counters["frames_emitted"],
                        "bytes_emitted": counters["bytes_emitted"],
                        "ttfb_ms": counters["ttfb_ms"],
                        "total_ms": total_ms,
                        "scope_type": scope_raw.get("type"),
                        "user_id_hash": hashlib.sha256(
                            user_id.encode("utf-8")
                        ).hexdigest()[:16],
                    },
                    default=str,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.route("/api/insights/conversations", methods=["GET"])
def list_insights_conversations():
    """List the current therapist's insights conversations, newest first."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))
    try:
        limit = int(request.args.get("limit") or 50)
    except ValueError:
        limit = 50
    conversations = insights_service.list_conversations(user_id=user_id, limit=limit)
    return jsonify({"conversations": conversations})


@app.route("/api/insights/conversations/<conversation_id>", methods=["GET"])
def get_insights_conversation(conversation_id: str):
    """Return a single insights conversation with its full message history."""
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))
    payload = insights_service.get_conversation(user_id=user_id, conversation_id=conversation_id)
    if payload is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(payload)


# ---------------------------------------------------------------------------
# Voice-agent action API
# ---------------------------------------------------------------------------
#
# These endpoints power the safe action loop for the fullscreen voice agent.
# The model only proposes actions (via the planner contract); the user must
# explicitly confirm; the server re-validates RBAC and dispatches through
# the existing LearningApi. All routes require VOICE_AGENT_ACTIONS_ENABLED.


def _require_voice_actions_enabled(
    user: Dict[str, Any],
) -> Optional[Tuple[Any, int]]:
    if not _voice_agent_actions_enabled(user):
        return jsonify({"error": "voice_agent_actions_disabled"}), 403
    return None


@app.route("/api/insights/voice-actions/suggest", methods=["POST"])
def voice_actions_suggest():
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response
    user_dict = cast(Dict[str, Any], user)
    guard = _require_voice_actions_enabled(user_dict)
    if guard is not None:
        return guard
    payload = request.get_json(silent=True) or {}
    suggestion = payload.get("suggestion") or payload
    try:
        record = voice_agent_action_service.suggest(
            user_id=str(user_dict.get("id")), suggestion=suggestion
        )
    except VoiceAgentActionError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    return jsonify(record)


@app.route("/api/insights/voice-actions/<suggestion_id>/confirm", methods=["POST"])
def voice_actions_confirm(suggestion_id: str):
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response
    user_dict = cast(Dict[str, Any], user)
    guard = _require_voice_actions_enabled(user_dict)
    if guard is not None:
        return guard
    payload = request.get_json(silent=True) or {}
    method = str(payload.get("method") or "click")
    try:
        record = voice_agent_action_service.confirm(
            user_id=str(user_dict.get("id")),
            suggestion_id=suggestion_id,
            method=method,
        )
    except VoiceAgentActionError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    return jsonify(record)


@app.route("/api/insights/voice-actions/<suggestion_id>/execute", methods=["POST"])
def voice_actions_execute(suggestion_id: str):
    user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response
    user_dict = cast(Dict[str, Any], user)
    guard = _require_voice_actions_enabled(user_dict)
    if guard is not None:
        return guard
    payload = request.get_json(silent=True) or {}
    idempotency_key = (
        request.headers.get("Idempotency-Key")
        or str(payload.get("idempotency_key") or "")
        or None
    )
    try:
        result = voice_agent_action_service.execute(
            user_id=str(user_dict.get("id")),
            user_role=str(user_dict.get("role") or ""),
            suggestion_id=suggestion_id,
            idempotency_key=idempotency_key,
        )
    except VoiceAgentActionError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    return jsonify(result)


# ---------------------------------------------------------------------------
# UI state (onboarding/guidance persistence)
# ---------------------------------------------------------------------------
#
# Implements Phase 1 of docs/onboarding/onboarding-plan-v2.md. These routes are
# authenticated-only — they must remain gated by Easy Auth and must NOT appear
# in ``globalValidation.excludedPaths`` in infra/resources.bicep.


@app.route("/api/me/ui-state", methods=["GET"])
def get_me_ui_state():
    """Return the current user's UI state blob."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))
    state = storage_service.get_user_ui_state(user_id)
    return jsonify({"ui_state": state or {}})


@app.route("/api/me/ui-state", methods=["PATCH"])
def patch_me_ui_state():
    """Shallow-merge a validated patch into the current user's UI state."""
    from src.schemas.ui_state import validate_ui_state_patch

    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))

    body = request.get_json(silent=True)
    patch, errors = validate_ui_state_patch(body)
    if errors:
        return jsonify({"error": "invalid_ui_state_patch", "details": errors}), 422

    try:
        merged = storage_service.patch_user_ui_state(user_id, patch)
    except ValueError as error:
        code = str(error)
        if code == "user_not_found":
            return jsonify({"error": "user_not_found"}), HTTP_NOT_FOUND
        if code == "ui_state_too_large":
            return jsonify({"error": "ui_state_too_large"}), 413
        raise

    try:
        storage_service.log_ui_state_audit(
            user_id=user_id,
            event="ui_state.patched",
            payload={"keys": sorted(patch.keys())},
        )
    except Exception:  # pragma: no cover - audit must never break the write
        logger.exception("Failed to record ui_state_audit row for %s", user_id)

    _log_audit_event(
        user_id=user_id,
        action="ui_state.patched",
        resource_type="ui_state",
        resource_id=user_id,
        metadata={"keys": sorted(patch.keys())},
    )
    return jsonify({"ui_state": merged})


@app.route("/api/me/ui-state", methods=["DELETE"])
def delete_me_ui_state():
    """Reset the current user's UI state to ``{}`` (audited)."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))

    try:
        storage_service.reset_user_ui_state(user_id)
    except ValueError as error:
        if str(error) == "user_not_found":
            return jsonify({"error": "user_not_found"}), HTTP_NOT_FOUND
        raise

    try:
        storage_service.log_ui_state_audit(
            user_id=user_id,
            event="ui_state.reset",
            payload={},
        )
    except Exception:  # pragma: no cover
        logger.exception("Failed to record ui_state_audit reset for %s", user_id)

    _log_audit_event(
        user_id=user_id,
        action="ui_state.reset",
        resource_type="ui_state",
        resource_id=user_id,
    )
    return jsonify({"ui_state": {}})


@app.route("/api/children/<child_id>/ui-state", methods=["GET"])
def get_child_ui_state(child_id: str):
    """Return the per-exercise first-run flags for ``child_id`` viewed by this therapist."""
    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))
    payload = storage_service.get_child_ui_state(child_id, user_id)
    return jsonify(payload)


@app.route("/api/children/<child_id>/ui-state", methods=["PUT"])
def put_child_ui_state(child_id: str):
    """Set or clear a first-run marker for ``(child_id, this-therapist, exercise_type)``."""
    from src.schemas.ui_state import validate_child_ui_state_put

    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response
    user_id = str(cast(Dict[str, Any], user).get("id"))

    body = request.get_json(silent=True)
    payload, errors = validate_child_ui_state_put(body)
    if errors:
        return jsonify({"error": "invalid_child_ui_state", "details": errors}), 422

    result = storage_service.put_child_ui_state_first_run(
        child_id=child_id,
        user_id=user_id,
        exercise_type=payload["exercise_type"],
        first_run=payload["first_run"],
    )

    try:
        storage_service.log_ui_state_audit(
            user_id=user_id,
            event="child_ui_state.put",
            payload={
                "child_id": child_id,
                "exercise_type": payload["exercise_type"],
                "first_run": payload["first_run"],
            },
        )
    except Exception:  # pragma: no cover
        logger.exception("Failed to record child ui_state_audit row for %s", user_id)

    _log_audit_event(
        user_id=user_id,
        action="child_ui_state.put",
        resource_type="child_ui_state",
        resource_id=f"{child_id}:{payload['exercise_type']}",
        child_id=child_id,
        metadata={"first_run": payload["first_run"]},
    )
    return jsonify(result)


@app.route(API_CHILD_RECOMMENDATIONS_ENDPOINT, methods=["GET", "POST"])
def child_recommendations(child_id: str):
    """List or generate therapist-facing next-exercise recommendations."""
    if request.method == "POST":
        user, guard_response = _require_child_access(
            child_id,
            allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
            allowed_relationships=["therapist"],
        )
        if guard_response is not None:
            return guard_response

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        source_session_id = str(data.get("source_session_id") or "").strip() or None
        target_sound = str(data.get("target_sound") or "").strip() or None
        therapist_constraints = str(data.get("therapist_constraints") or data.get("message") or "").strip() or None
        try:
            limit = max(1, min(8, int(data.get("limit") or 5)))
        except (TypeError, ValueError):
            return jsonify({"error": "limit must be a number between 1 and 8"}), HTTP_BAD_REQUEST

        try:
            result = recommendation_service.generate_recommendations(
                child_id=child_id,
                source_session_id=source_session_id,
                target_sound=target_sound,
                therapist_constraints=therapist_constraints,
                limit=limit,
                created_by_user_id=str(cast(Dict[str, Any], user).get("id")),
            )
        except ValueError as error:
            message = str(error)
            status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
            return jsonify({"error": message}), status_code

        telemetry_service.track_event(
            "recommendation_log_created",
            properties={
                "child_id": child_id,
                "source_session_id": source_session_id,
                "recommendation_id": result["id"],
            },
        )
        return jsonify(result), 201

    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    try:
        limit = max(1, min(20, int(request.args.get("limit") or 10)))
    except (TypeError, ValueError):
        return jsonify({"error": "limit must be a number between 1 and 20"}), HTTP_BAD_REQUEST

    history = recommendation_service.list_recommendation_history(child_id, limit=limit)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="recommendation.list",
        resource_type="recommendation_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(history)},
    )
    return jsonify(history)


@app.route(API_RECOMMENDATION_DETAIL_ENDPOINT)
def get_recommendation_detail(recommendation_id: str):
    """Return one durable recommendation run with explanation and provenance."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        detail = recommendation_service.get_recommendation_detail(recommendation_id)
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(str(detail.get("child_id") or ""))
    if child_guard is not None:
        return child_guard

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="recommendation.read",
        resource_type="recommendation",
        resource_id=recommendation_id,
        child_id=str(detail.get("child_id") or ""),
    )
    return jsonify(detail)


@app.route(API_CHILD_REPORTS_ENDPOINT, methods=["GET", "POST"])
def child_progress_reports(child_id: str):
    """List or create therapist-facing progress reports for a child."""
    allowed_roles = {ROLE_THERAPIST, ROLE_ADMIN}
    allowed_relationships = ["therapist"]

    if request.method == "POST":
        user, guard_response = _require_child_access(
            child_id,
            allowed_roles=allowed_roles,
            allowed_relationships=allowed_relationships,
            enforce_data_consent=True,
        )
        if guard_response is not None:
            return guard_response

        data = cast(Dict[str, Any], request.get_json(silent=True) or {})
        included_session_ids = data.get("included_session_ids")
        if included_session_ids is not None and not isinstance(included_session_ids, list):
            return jsonify({"error": "included_session_ids must be a list"}), HTTP_BAD_REQUEST
        redaction_overrides = data.get("redaction_overrides")
        if redaction_overrides is not None and not isinstance(redaction_overrides, dict):
            return jsonify({"error": "redaction_overrides must be an object"}), HTTP_BAD_REQUEST

        try:
            report = report_service.create_report(
                child_id=child_id,
                created_by_user_id=str(cast(Dict[str, Any], user).get("id")),
                audience=str(data.get("audience") or "therapist"),
                title=str(data.get("title") or "").strip() or None,
                report_type=str(data.get("report_type") or "progress_summary").strip() or "progress_summary",
                period_start=str(data.get("period_start") or "").strip() or None,
                period_end=str(data.get("period_end") or "").strip() or None,
                included_session_ids=cast(Optional[List[str]], included_session_ids),
                summary_text=str(data.get("summary_text") or "").strip() or None,
                redaction_overrides=cast(Optional[Dict[str, Any]], redaction_overrides),
            )
        except ValueError as error:
            message = str(error)
            status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
            return jsonify({"error": message}), status_code

        telemetry_service.track_event(
            "progress_report_created",
            properties={
                "child_id": child_id,
                "report_id": report["id"],
                "audience": report["audience"],
            },
        )
        _log_audit_event(
            user_id=str(cast(Dict[str, Any], user).get("id")),
            action="report.create",
            resource_type="progress_report",
            resource_id=str(report.get("id") or ""),
            child_id=child_id,
        )
        return jsonify(report), HTTP_CREATED

    user, guard_response = _require_child_access(
        child_id,
        allowed_roles=allowed_roles,
        allowed_relationships=allowed_relationships,
        enforce_data_consent=True,
    )
    if guard_response is not None:
        return guard_response

    try:
        limit = max(1, min(50, int(request.args.get("limit") or 20)))
    except (TypeError, ValueError):
        return jsonify({"error": "limit must be a number between 1 and 50"}), HTTP_BAD_REQUEST

    try:
        reports = report_service.list_reports(
            child_id,
            status=str(request.args.get("status") or "").strip() or None,
            audience=str(request.args.get("audience") or "").strip() or None,
            limit=limit,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), HTTP_BAD_REQUEST

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.list",
        resource_type="progress_report_collection",
        resource_id=child_id,
        child_id=child_id,
        metadata={"count": len(reports)},
    )
    return jsonify(reports)


@app.route(API_REPORT_DETAIL_ENDPOINT)
def get_progress_report(report_id: str):
    """Return one saved progress report."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        report = report_service.get_report(report_id)
    except ValueError:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(
        str(report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if child_guard is not None:
        return child_guard

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.read",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
    )
    return jsonify(report)


@app.route(API_REPORT_EXPORT_ENDPOINT)
def export_progress_report(report_id: str):
    """Render one saved progress report as HTML or PDF."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    try:
        report = report_service.get_report(report_id)
    except ValueError:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(
        str(report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if child_guard is not None:
        return child_guard

    export_format = str(request.args.get("format") or "html").strip().lower()
    if export_format not in {"html", "pdf"}:
        return jsonify({"error": "format must be html or pdf"}), HTTP_BAD_REQUEST

    download_requested = str(request.args.get("download") or "").strip().lower() in {"1", "true", "yes"}
    disposition = "attachment" if download_requested else "inline"

    try:
        if export_format == "pdf":
            document = report_service.render_report_pdf(report_id)
            response = app.response_class(document, mimetype="application/pdf")
        else:
            document = report_service.render_report_html(report_id)
            response = app.response_class(document, mimetype="text/html")
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 503

    response.headers["Content-Disposition"] = f'{disposition}; filename="progress-report.{export_format}"'
    response.headers["Cache-Control"] = "no-store"

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.export",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
        metadata={"format": export_format, "download": download_requested},
    )
    return response


@app.route(API_REPORT_UPDATE_ENDPOINT, methods=["POST"])
def update_progress_report(report_id: str):
    """Update editable draft report fields."""
    existing_report = storage_service.get_progress_report(report_id)
    if existing_report is None:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(existing_report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    sections = data.get("sections")
    if sections is not None and not isinstance(sections, list):
        return jsonify({"error": "sections must be a list"}), HTTP_BAD_REQUEST
    included_session_ids = data.get("included_session_ids")
    if included_session_ids is not None and not isinstance(included_session_ids, list):
        return jsonify({"error": "included_session_ids must be a list"}), HTTP_BAD_REQUEST
    redaction_overrides = data.get("redaction_overrides")
    if redaction_overrides is not None and not isinstance(redaction_overrides, dict):
        return jsonify({"error": "redaction_overrides must be an object"}), HTTP_BAD_REQUEST

    try:
        report = report_service.update_report(
            report_id,
            audience=str(data.get("audience") or "").strip() or None,
            title=str(data.get("title") or "").strip() or None,
            period_start=str(data.get("period_start") or "").strip() or None,
            period_end=str(data.get("period_end") or "").strip() or None,
            included_session_ids=cast(Optional[List[str]], included_session_ids),
            summary_text=str(data.get("summary_text") or "").strip() or None,
            sections=cast(Optional[List[Dict[str, Any]]], sections),
            redaction_overrides=cast(Optional[Dict[str, Any]], redaction_overrides),
        )
    except ValueError as error:
        message = str(error)
        status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
        return jsonify({"error": message}), status_code

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.update",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
    )
    return jsonify(report)


@app.route(API_REPORT_SUMMARY_REWRITE_ENDPOINT, methods=["POST"])
def suggest_progress_report_summary_rewrite(report_id: str):
    """Generate a human-reviewed AI summary suggestion for a draft report."""
    existing_report = storage_service.get_progress_report(report_id)
    if existing_report is None:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(existing_report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    try:
        suggestion = report_service.suggest_summary_rewrite(report_id)
    except ValueError as error:
        message = str(error)
        status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
        return jsonify({"error": message}), status_code
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 503

    telemetry_service.track_event(
        "progress_report_summary_rewrite_suggested",
        properties={"report_id": report_id, "child_id": existing_report["child_id"]},
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.summary_rewrite.suggest",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(existing_report.get("child_id") or ""),
    )
    return jsonify(suggestion)


@app.route(API_REPORT_APPROVE_ENDPOINT, methods=["POST"])
def approve_progress_report(report_id: str):
    """Approve a draft report for release."""
    existing_report = storage_service.get_progress_report(report_id)
    if existing_report is None:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(existing_report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    try:
        report = report_service.approve_report(report_id)
    except ValueError as error:
        message = str(error)
        status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
        return jsonify({"error": message}), status_code

    telemetry_service.track_event(
        "progress_report_approved",
        properties={"report_id": report_id, "child_id": report["child_id"]},
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.approve",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
    )
    return jsonify(report)


@app.route(API_REPORT_SIGN_ENDPOINT, methods=["POST"])
def sign_progress_report(report_id: str):
    """Apply therapist signature metadata to an approved report."""
    existing_report = storage_service.get_progress_report(report_id)
    if existing_report is None:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(existing_report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    try:
        report = report_service.sign_report(report_id, str(cast(Dict[str, Any], user).get("id")))
    except ValueError as error:
        message = str(error)
        status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
        return jsonify({"error": message}), status_code

    telemetry_service.track_event(
        "progress_report_signed",
        properties={"report_id": report_id, "child_id": report["child_id"]},
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.sign",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
    )
    return jsonify(report)


@app.route(API_REPORT_ARCHIVE_ENDPOINT, methods=["POST"])
def archive_progress_report(report_id: str):
    """Archive a completed report."""
    existing_report = storage_service.get_progress_report(report_id)
    if existing_report is None:
        return jsonify({"error": REPORT_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(existing_report.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    try:
        report = report_service.archive_report(report_id)
    except ValueError as error:
        message = str(error)
        status_code = HTTP_NOT_FOUND if "not found" in message.lower() else HTTP_BAD_REQUEST
        return jsonify({"error": message}), status_code

    telemetry_service.track_event(
        "progress_report_archived",
        properties={"report_id": report_id, "child_id": report["child_id"]},
    )
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="report.archive",
        resource_type="progress_report",
        resource_id=report_id,
        child_id=str(report.get("child_id") or ""),
    )
    return jsonify(report)


@app.route(API_MEMORY_EVIDENCE_ENDPOINT)
def get_child_memory_evidence(subject_type: str, subject_id: str):
    """Return evidence links for a memory proposal or approved item."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    if subject_type not in {"item", "proposal"}:
        return jsonify({"error": "subject_type must be 'item' or 'proposal'"}), HTTP_BAD_REQUEST

    subject = (
        storage_service.get_child_memory_item(subject_id)
        if subject_type == "item"
        else storage_service.get_child_memory_proposal(subject_id)
    )
    if subject is None:
        return jsonify({"error": "Memory subject not found"}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(str(subject.get("child_id") or ""))
    if child_guard is not None:
        return child_guard

    links = child_memory_service.list_evidence_links(subject_type, subject_id)
    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="memory.evidence.list",
        resource_type=f"{subject_type}_evidence",
        resource_id=subject_id,
        child_id=str(subject.get("child_id") or ""),
        metadata={"count": len(links)},
    )
    return jsonify(links)


@app.route(API_PLANS_ENDPOINT, methods=["POST"])
def create_practice_plan():
    """Create a therapist-facing practice plan from a saved session."""
    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    child_id = str(data.get("child_id") or "").strip()
    source_session_id = str(data.get("source_session_id") or "").strip()
    therapist_message = str(data.get("message") or "").strip()

    if not child_id or not source_session_id:
        return jsonify({"error": "child_id and source_session_id are required"}), HTTP_BAD_REQUEST

    user, guard_response = _require_child_access(
        child_id,
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

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
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    plan = storage_service.get_practice_plan(plan_id)
    if plan is None:
        return jsonify({"error": PLAN_NOT_FOUND}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(str(plan.get("child_id") or ""))
    if child_guard is not None:
        return child_guard

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="plan.read",
        resource_type="practice_plan",
        resource_id=plan_id,
        child_id=str(plan.get("child_id") or ""),
    )

    return jsonify(plan)


@app.route(API_PLAN_MESSAGES_ENDPOINT, methods=["POST"])
def refine_practice_plan(plan_id: str):
    """Refine an existing practice plan using a therapist instruction."""
    plan = storage_service.get_practice_plan(plan_id)
    if plan is None:
        return jsonify({"error": PLAN_NOT_FOUND}), HTTP_NOT_FOUND

    _, guard_response = _require_child_access(
        str(plan.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
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
    existing_plan = storage_service.get_practice_plan(plan_id)
    if existing_plan is None:
        return jsonify({"error": PLAN_NOT_FOUND}), HTTP_NOT_FOUND

    _, guard_response = _require_child_access(
        str(existing_plan.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
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


@app.route(API_MEMORY_PROPOSAL_APPROVE_ENDPOINT, methods=["POST"])
def approve_child_memory_proposal(proposal_id: str):
    """Approve a pending child memory proposal and rebuild the child summary."""
    proposal = storage_service.get_child_memory_proposal(proposal_id)
    if proposal is None:
        return jsonify({"error": MEMORY_PROPOSAL_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(proposal.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    review_note = str(data.get("note") or "").strip() or None

    try:
        result = child_memory_service.approve_proposal(
            proposal_id,
            reviewer_user_id=str(cast(Dict[str, Any], user).get("id")),
            review_note=review_note,
        )
    except ValueError as error:
        status_code = HTTP_NOT_FOUND if MEMORY_PROPOSAL_NOT_FOUND in str(error) else HTTP_BAD_REQUEST
        return jsonify({"error": str(error)}), status_code

    return jsonify(result)


@app.route(API_MEMORY_PROPOSAL_REJECT_ENDPOINT, methods=["POST"])
def reject_child_memory_proposal(proposal_id: str):
    """Reject a pending child memory proposal and rebuild the child summary."""
    proposal = storage_service.get_child_memory_proposal(proposal_id)
    if proposal is None:
        return jsonify({"error": MEMORY_PROPOSAL_NOT_FOUND}), HTTP_NOT_FOUND

    user, guard_response = _require_child_access(
        str(proposal.get("child_id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    review_note = str(data.get("note") or "").strip() or None

    try:
        result = child_memory_service.reject_proposal(
            proposal_id,
            reviewer_user_id=str(cast(Dict[str, Any], user).get("id")),
            review_note=review_note,
        )
    except ValueError as error:
        status_code = HTTP_NOT_FOUND if MEMORY_PROPOSAL_NOT_FOUND in str(error) else HTTP_BAD_REQUEST
        return jsonify({"error": str(error)}), status_code

    return jsonify(result)


@app.route(API_SESSION_DETAIL_ENDPOINT)
def get_session_detail(session_id: str):
    """Return the full saved session detail for therapist review."""
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return guard_response

    session = storage_service.get_session(session_id)
    if session is None:
        return jsonify({"error": SESSION_NOT_FOUND}), HTTP_NOT_FOUND

    _, child_guard = _require_child_access(
        str(cast(Dict[str, Any], session.get("child") or {}).get("id") or ""),
        enforce_data_consent=True,
    )
    if child_guard is not None:
        return child_guard

    telemetry_service.track_event(
        "therapist_review_opened",
        properties={
            "session_id": session_id,
            "exercise_id": cast(Dict[str, Any], session.get("exercise") or {}).get("id"),
        },
    )

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], user).get("id")),
        action="session.read",
        resource_type="session",
        resource_id=session_id,
        child_id=str(cast(Dict[str, Any], session.get("child") or {}).get("id") or ""),
    )

    return jsonify(session)


@app.route(API_SESSION_FEEDBACK_ENDPOINT, methods=["POST"])
def save_session_feedback(session_id: str):
    """Store lightweight therapist feedback for a completed session."""
    existing_session = storage_service.get_session(session_id)
    if existing_session is None:
        return jsonify({"error": SESSION_NOT_FOUND}), HTTP_NOT_FOUND

    _, guard_response = _require_child_access(
        str(cast(Dict[str, Any], existing_session.get("child") or {}).get("id") or ""),
        allowed_roles={ROLE_THERAPIST, ROLE_ADMIN},
        allowed_relationships=["therapist"],
    )
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
    acting_user, guard_response = _require_therapist_user()
    if guard_response is not None:
        return guard_response

    data = cast(Dict[str, Any], request.get_json(silent=True) or {})
    role = str(data.get("role") or "").strip().lower()
    if role not in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN, ROLE_LEARNER}:
        return jsonify({"error": INVALID_ROLE}), HTTP_BAD_REQUEST

    acting_role = str(cast(Dict[str, Any], acting_user).get("role") or "")
    if role == ROLE_ADMIN and acting_role != ROLE_ADMIN:
        return jsonify({"error": "Only admins can assign the admin role"}), HTTP_FORBIDDEN

    target_user = storage_service.get_user(user_id)
    previous_role = str(target_user.get("role") or "") if target_user else ""

    try:
        user = storage_service.update_user_role(user_id, role)
    except ValueError:
        return jsonify({"error": INVALID_ROLE}), HTTP_BAD_REQUEST

    if user is None:
        return jsonify({"error": USER_NOT_FOUND}), HTTP_NOT_FOUND

    _log_audit_event(
        user_id=str(cast(Dict[str, Any], acting_user).get("id")),
        action="user.role.update",
        resource_type="user",
        resource_id=user_id,
        metadata={"role": role, "previous_role": previous_role, "acting_role": acting_role},
    )

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
    return send_from_directory(_refresh_static_folder(), AUDIO_PROCESSOR_FILE)


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

    user = _get_authenticated_user_from_headers(ws_headers)
    if user is None:
        logger.warning("Rejected unauthenticated WebSocket connection")
        ws.close()
        return

    query = parse_qs(str(environ.get("QUERY_STRING") or ""), keep_blank_values=False)
    scope = str((query.get("scope") or ["practice"])[0] or "practice").strip().lower() or "practice"
    if not _is_voice_scope_allowed_for_role(scope, str(user.get("role") or "")):
        logger.warning("Rejected learner VoiceLive WebSocket connection for role %s", user.get("role"))
        ws.close(4403, "voice_learner_forbidden")
        return

    if scope == "learner_ask" and not _pathfinder_voicelive_enabled(user):
        logger.info("Rejected learner_ask VoiceLive connection: flag disabled")
        ws.close(4404, "voice_voicelive_disabled")
        return

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    loop.run_until_complete(voice_proxy_handler.handle_connection(ws))


def insights_voice_socket(ws: simple_websocket.ws.Server):
    raw_mode = str(os.getenv("INSIGHTS_VOICE_MODE", "off") or "off").strip().lower()
    if raw_mode not in {"push_to_talk", "full_duplex"}:
        ws.close(4404)
        return

    user = _require_therapist_ws(ws)
    if user is None:
        return

    environ = cast(Dict[str, Any], getattr(ws, "environ", {}) or {})
    query = parse_qs(str(environ.get("QUERY_STRING") or ""), keep_blank_values=False)

    scope_type = str((query.get("scope_type") or ["caseload"])[0] or "caseload").strip() or "caseload"
    if scope_type not in {"caseload", "child", "session", "report"}:
        ws.close(4403, "insights_voice_invalid_scope")
        return

    child_id = str((query.get("child_id") or [""])[0] or "").strip() or None
    scope: Dict[str, Any] = {"type": scope_type}
    if child_id:
        scope["child_id"] = child_id

    if scope_type == "child":
        if not child_id or not storage_service.user_has_child_access(str(user.get("id") or ""), child_id):
            ws.close(4403, "insights_voice_forbidden")
            return

    conversation_id = str((query.get("conversation_id") or [""])[0] or "").strip() or None
    if conversation_id:
        conversation = storage_service.get_insight_conversation(
            conversation_id,
            user_id=str(user.get("id") or ""),
        )
        if conversation is None:
            ws.close(4403, "insights_voice_forbidden")
            return

    handler = InsightsVoiceHandler(
        ws,
        insights_service=insights_service,
        storage=storage_service,
        user=user,
        scope=scope,
        conversation_id=conversation_id,
    )
    handler.run()
    try:
        ws.close(1000)
    except Exception:
        logger.debug("Failed to close insights voice websocket cleanly", exc_info=True)


sock.route("/ws/insights-voice")(insights_voice_socket)  # pyright: ignore[reportUnknownMemberType]


def learner_voice_socket(ws: simple_websocket.ws.Server):
    """Realtime transport for the unified learner assistant.

    The voice twin of ``POST /api/learning/assistant/turn``: it authenticates the
    socket, binds the learner's RLS scope, then pumps every frame through the
    same ``run_assistant_turn`` brain so voice and text share one vocabulary of
    :class:`AssistantBlock` results. STT/TTS happen at the client edge — this
    layer streams blocks, not audio.
    """
    environ = cast(Dict[str, Any], getattr(ws, "environ", {}) or {})
    ws_headers = {
        "X-MS-CLIENT-PRINCIPAL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL", ""),
        "X-MS-CLIENT-PRINCIPAL-ID": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_ID", ""),
        "X-MS-CLIENT-PRINCIPAL-NAME": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_NAME", ""),
        "X-MS-CLIENT-PRINCIPAL-IDP": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_IDP", ""),
        "X-MS-CLIENT-PRINCIPAL-EMAIL": environ.get("HTTP_X_MS_CLIENT_PRINCIPAL_EMAIL", ""),
    }
    user = _get_authenticated_user_from_headers(ws_headers)
    if user is None:
        logger.warning("Rejected unauthenticated learner voice WebSocket connection")
        ws.close(4401, "learning_voice_unauthorized")
        return

    role = str(user.get("role") or "")
    if role == ROLE_PENDING_THERAPIST:
        ws.close(4403, "learning_voice_forbidden")
        return

    # Learner roles are scoped to the children they own; teachers/admins pass
    # through with no child binding (an empty owned set disables the per-frame
    # child check, matching the text endpoint's learning policy).
    owned_child_ids: set[str] = set()
    if role in LEARNING_LEARNER_ROLES:
        owned_child_ids = _learning_student_ids_for_user(user)
        # The unified assistant turn is self-directed: the client sends
        # ``child_id == the learner's own id`` (see AskPathfinder.buildContext),
        # exactly as the text twin ``/api/learning/assistant/turn`` does — which
        # never gates on ``child_id``. So a learner may always act on their own
        # id; the per-frame check still rejects any *other* unowned child. Without
        # this, a learner who also owns children (non-empty owned set that
        # excludes their own id) is wrongly rejected with ``child_access_required``
        # and the voice surface shows the connection-hiccup banner.
        self_id = str(user.get("id") or "").strip()
        if self_id:
            owned_child_ids.add(self_id)

    query = parse_qs(str(environ.get("QUERY_STRING") or ""), keep_blank_values=False)
    default_user_id = str((query.get("user_id") or [""])[0] or user.get("id") or "").strip()
    defaults: Dict[str, Any] = {}
    if default_user_id:
        defaults["user_id"] = default_user_id

    def _bind_scope(payload: Mapping[str, Any]) -> None:
        tenant_id, class_id = _learning_scope_from_request(payload)
        authorized = _learning_authorized_tenant_ids(user)
        if authorized and tenant_id not in authorized:
            tenant_id = sorted(authorized)[0]
        _bind_learning_storage_scope(tenant_id, class_id)

    handler = LearnerVoiceSocketHandler(
        ws,
        run_turn=learning_api.run_assistant_turn,
        owned_child_ids=owned_child_ids,
        bind_scope=_bind_scope,
        default_payload=defaults,
    )
    try:
        handler.run()
    finally:
        _shutdown_ws_socket(ws)


sock.route("/ws/learning-voice")(learner_voice_socket)  # pyright: ignore[reportUnknownMemberType]



def main():
    """Run the Flask application."""
    host = config["host"]
    port = config["port"]
    print(f"Starting Voice Live Demo on http://{host}:{port}")

    debug_mode = os.getenv("FLASK_ENV") == "development"
    # threaded=True lets the SSE chat endpoint hold a long-lived response
    # without blocking the regular REST surface served by the same dev server.
    app.run(host=host, port=port, debug=debug_mode, threaded=True)


if __name__ == "__main__":
    main()
