# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Flask application for the Wulo agent."""

import asyncio
import base64
from collections import defaultdict
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import sys
import threading
import time
from typing import Any, Dict, List, Mapping, Optional, Tuple, cast
from urllib.parse import urlsplit

import simple_websocket.ws  # pyright: ignore[reportMissingTypeStubs]
from flask import Flask, abort, g, jsonify, request, send_from_directory
from flask_sock import Sock  # pyright: ignore[reportMissingTypeStubs]

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import config
from src.services.analyzers import ConversationAnalyzer, PronunciationAssessor
from src.services.child_memory_service import ChildMemoryService
from src.services.email_service import AzureCommunicationEmailService, InvitationEmailDeliveryResult
from src.services.institutional_memory_service import InstitutionalMemoryService
from src.services.insights_copilot_planner import build_insights_planner_from_env
from src.services.insights_service import (
    InsightsAuthorizationError,
    InsightsService,
)
from src.services.managers import AgentManager, ScenarioManager
from src.services.planning_service import PracticePlanningService
from src.services.report_pipeline import AzureOpenAIReportSummaryAssistant
from src.services.report_service import ProgressReportService
from src.services.recommendation_service import RecommendationService
from src.services.storage_factory import create_storage_service
from src.services.telemetry import PilotTelemetryService
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
API_AUTH_SESSION_ENDPOINT = "/api/auth/session"
API_AUTH_CLAIM_INVITE_CODE_ENDPOINT = "/api/auth/claim-invite-code"
API_ADMIN_INVITE_CODES_ENDPOINT = "/api/admin/invite-codes"
API_WORKSPACES_ENDPOINT = "/api/workspaces"
API_PILOT_STATE_ENDPOINT = "/api/pilot/state"
API_CONSENT_ENDPOINT = "/api/pilot/consent"
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
UNSAFE_HTTP_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_RATE_LIMIT_STATE: dict[tuple[str, str], list[float]] = defaultdict(list)
_RATE_LIMIT_LOCK = threading.Lock()


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
            insights_planner = build_insights_planner_from_env(config.as_dict)
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to build Copilot insights planner; falling back to stub")
            insights_planner = None
        if insights_planner is not None:
            logger.info("Insights planner: Copilot SDK adapter enabled")
        else:
            logger.info("Insights planner: using stub (SDK or credentials not configured)")
    insights_service = InsightsService(
        storage_service,
        child_memory_service=child_memory_service,
        institutional_memory_service=institutional_memory_service,
        planner=insights_planner,
    )
    planner_startup_readiness = planning_service.get_readiness(force_refresh=True)
    if not planner_startup_readiness.get("ready"):
        logger.warning("Planner readiness check failed at startup: %s", planner_startup_readiness)


initialize_runtime_services()


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

    if not child_id:
        raise ValueError("child_id is required")

    session = storage_service.save_session(
        {
            "child_id": child_id,
            "child_name": child_name,
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


def _resolve_local_dev_role() -> str:
    role = _normalize_context_value(os.environ.get("LOCAL_DEV_USER_ROLE")).lower()
    if role in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN}:
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


def _require_role(*roles: str) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    user, guard_response = _require_authenticated()
    if guard_response is not None:
        return None, guard_response

    if user is None or str(user.get("role") or "") not in set(roles):
        return None, (jsonify({"error": THERAPIST_ROLE_REQUIRED}), HTTP_FORBIDDEN)

    return user, None


def _require_child_access(
    child_id: str,
    *,
    allowed_roles: Optional[set[str]] = None,
    allowed_relationships: Optional[List[str]] = None,
    include_deleted: bool = False,
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

    return user, None


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
            "image_base_path": "/api/images",
            "planner": planning_service.get_readiness(),
            "insights_rail_enabled": _insights_rail_enabled(
                cast(Dict[str, Any], user) if user else None
            ),
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

    user_workspaces = storage_service.list_workspaces_for_user(str(user["id"]))
    default_workspace = storage_service.get_default_workspace_for_user(str(user["id"]))

    return jsonify(
        {
            "authenticated": True,
            "user_id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "provider": user["provider"],
            "role": user["role"],
            "current_workspace_id": None if default_workspace is None else default_workspace["id"],
            "user_workspaces": user_workspaces,
        }
    )


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
    user_workspaces = storage_service.list_workspaces_for_user(user_id)
    default_workspace = storage_service.get_default_workspace_for_user(user_id)

    return jsonify(
        {
            "authenticated": True,
            "user_id": user_id,
            "name": updated_user["name"] if updated_user else "",
            "email": updated_user["email"] if updated_user else "",
            "provider": updated_user["provider"] if updated_user else "",
            "role": updated_user["role"] if updated_user else "",
            "current_workspace_id": None if default_workspace is None else default_workspace["id"],
            "user_workspaces": user_workspaces,
        }
    )


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
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN},
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
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN},
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
        allowed_roles={ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN},
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
    if not is_admin and str(existing_invitation.get("invited_by_user_id") or "") != str(cast(Dict[str, Any], user).get("id") or ""):
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
    if not is_admin and str(existing_invitation.get("invited_by_user_id") or "") != str(cast(Dict[str, Any], user).get("id") or ""):
        return jsonify({"error": CHILD_ACCESS_REQUIRED}), HTTP_FORBIDDEN

    invitation = storage_service.resend_child_invitation(invitation_id)
    if invitation is None:
        return jsonify({"error": "Invitation cannot be resent"}), HTTP_BAD_REQUEST

    email_delivery = _send_invitation_email(
        invitation,
        inviter_name=str(existing_invitation.get("invited_by_name") or cast(Dict[str, Any], user).get("name") or "Your therapist"),
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
            child_memory_service.build_live_session_personalization(child_id)
            if child_id
            else None
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
                    "auto_applied_items": float(len(cast(List[Dict[str, Any]], memory_result.get("auto_applied_items") or []))),
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
            "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"en-GB\">"
            f"<voice name=\"{_escape_xml(voice_name)}\">"
            f"<phoneme alphabet=\"{_escape_xml(alphabet)}\" ph=\"{_escape_xml(phoneme)}\">"
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
    user, guard_response = _require_child_access(child_id)
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
    user, guard_response = _require_child_access(child_id)
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
    payload = insights_service.get_conversation(
        user_id=user_id, conversation_id=conversation_id
    )
    if payload is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(payload)


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

    _, child_guard = _require_child_access(str(cast(Dict[str, Any], session.get("child") or {}).get("id") or ""))
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
    if role not in {ROLE_THERAPIST, ROLE_PARENT, ROLE_ADMIN}:
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
