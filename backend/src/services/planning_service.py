"""Therapist planning service backed by the GitHub Copilot SDK."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional
from uuid import uuid4

from src.config import config
from src.services.plan_validation import normalize_plan_draft

try:
    from copilot import CopilotClient
    from copilot.client import SubprocessConfig
    from copilot.session import PermissionRequestResult
    from copilot.tools import Tool, ToolResult
except ImportError:  # pragma: no cover - exercised indirectly by runtime checks
    CopilotClient = None
    SubprocessConfig = None
    PermissionRequestResult = None
    Tool = None
    ToolResult = None


logger = logging.getLogger(__name__)

PLANNER_SESSION_PREFIX = "practice-planner"
DEFAULT_CREATE_MESSAGE = "Create a focused next-session plan from the selected session."
READINESS_CACHE_TTL_SECONDS = 60.0


def _approve_all_permissions(request: Any, invocation: Any) -> Any:
    del request, invocation
    return PermissionRequestResult(kind="approved")


@dataclass
class CopilotPlannerTurnResult:
    planner_session_id: str
    draft: Dict[str, Any]
    raw_content: str
    tool_calls: int


class CopilotPlannerRuntime:
    """Small adapter around the GitHub Copilot SDK for therapist planning turns."""

    CONTEXT_TOOL_NAME = "get_planning_context"
    EXERCISE_TOOL_NAME = "list_candidate_exercises"

    def __init__(
        self,
        storage_service: Any,
        scenario_manager: Any,
        settings: Mapping[str, Any],
    ):
        self.storage_service = storage_service
        self.scenario_manager = scenario_manager
        self.settings = settings
        self.model = str(settings.get("copilot_planner_model") or "gpt-5").strip() or "gpt-5"
        self.reasoning_effort = str(settings.get("copilot_planner_reasoning_effort") or "").strip()
        self.cli_path = str(settings.get("copilot_cli_path") or "").strip()
        self.github_token = str(settings.get("copilot_github_token") or "").strip()
        self.azure_provider = self._build_provider_config(settings)
        self._cached_readiness: Optional[Dict[str, Any]] = None
        self._cached_readiness_at: float = 0.0

    def get_readiness(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self._cached_readiness and (now - self._cached_readiness_at) < READINESS_CACHE_TTL_SECONDS:
            return dict(self._cached_readiness)

        readiness = self._build_readiness()
        self._cached_readiness = dict(readiness)
        self._cached_readiness_at = now
        return readiness

    def run_turn(
        self,
        *,
        planner_session_id: str,
        therapist_prompt: str,
        planning_context: Dict[str, Any],
    ) -> CopilotPlannerTurnResult:
        return asyncio.run(
            self._run_turn_async(
                planner_session_id=planner_session_id,
                therapist_prompt=therapist_prompt,
                planning_context=planning_context,
            )
        )

    async def _run_turn_async(
        self,
        *,
        planner_session_id: str,
        therapist_prompt: str,
        planning_context: Dict[str, Any],
    ) -> CopilotPlannerTurnResult:
        self._validate_sdk_available()

        tool_names = [self.CONTEXT_TOOL_NAME, self.EXERCISE_TOOL_NAME]
        tool_call_count = {"count": 0}
        client = self._create_client()
        await client.start()

        async def on_pre_tool_use(input_data: Dict[str, Any], invocation: Dict[str, str]) -> Dict[str, Any]:
            del input_data, invocation
            tool_call_count["count"] += 1
            return {"permissionDecision": "allow"}

        tools = self._build_tools(planning_context)
        session_kwargs: Dict[str, Any] = {
            "on_permission_request": _approve_all_permissions,
            "model": self.model,
            "tools": tools,
            "available_tools": tool_names,
            "system_message": {
                "mode": "replace",
                "content": self._build_system_message(),
            },
            "hooks": {
                "on_pre_tool_use": on_pre_tool_use,
            },
        }
        if self.reasoning_effort:
            session_kwargs["reasoning_effort"] = self.reasoning_effort
        if self.azure_provider is not None:
            session_kwargs["provider"] = self.azure_provider

        session = None
        try:
            try:
                session = await client.resume_session(planner_session_id, **session_kwargs)
            except Exception:
                session = await client.create_session(session_id=planner_session_id, **session_kwargs)

            response = await session.send_and_wait(therapist_prompt)
            response_content = self._extract_response_content(response)
            draft = normalize_plan_draft(self._extract_json_payload(response_content))
            return CopilotPlannerTurnResult(
                planner_session_id=session.session_id,
                draft=draft,
                raw_content=response_content,
                tool_calls=tool_call_count["count"],
            )
        finally:
            if session is not None:
                await session.disconnect()
            await client.stop()

    def _create_client(self) -> Any:
        if self.cli_path or self.github_token:
            return CopilotClient(
                SubprocessConfig(
                    cli_path=self.cli_path or None,
                    github_token=self.github_token or None,
                )
            )
        return CopilotClient()

    def _build_provider_config(self, settings: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
        endpoint = str(settings.get("azure_openai_endpoint") or "").strip()
        api_key = str(settings.get("azure_openai_api_key") or "").strip()
        if not endpoint or not api_key:
            return None

        return {
            "type": "azure",
            "base_url": endpoint,
            "api_key": api_key,
            "azure": {
                "api_version": str(settings.get("copilot_azure_api_version") or "2024-10-21"),
            },
        }

    def _build_readiness(self) -> Dict[str, Any]:
        sdk_available = CopilotClient is not None and PermissionRequestResult is not None and Tool is not None
        cli_resolution = self._resolve_cli_path()
        cli_available = bool(cli_resolution.get("available"))
        using_byok_provider = self.azure_provider is not None
        using_github_token = bool(self.github_token)
        auth_status = self._check_cli_auth_status(cli_resolution)
        planner_ready = bool(sdk_available and cli_available and (using_byok_provider or using_github_token or auth_status["authenticated"]))

        reasons: List[str] = []
        if not sdk_available:
            reasons.append("GitHub Copilot SDK package is not installed.")
        if not cli_available:
            reasons.append("Copilot CLI is not configured or not executable.")
        if cli_available and not (using_byok_provider or using_github_token or auth_status["authenticated"]):
            reasons.append("Copilot CLI authentication is not ready and no token/BYOK provider is configured.")

        return {
            "ready": planner_ready,
            "model": self.model,
            "sdk_installed": sdk_available,
            "cli": {
                "configured_path": self.cli_path or None,
                "resolved_path": cli_resolution.get("path"),
                "available": cli_available,
                "version": auth_status.get("version"),
                "auth_checked": auth_status.get("checked", False),
                "authenticated": auth_status.get("authenticated", False),
                "auth_message": auth_status.get("message"),
            },
            "auth": {
                "github_token_configured": using_github_token,
                "azure_byok_configured": using_byok_provider,
            },
            "reasons": reasons,
        }

    def _resolve_cli_path(self) -> Dict[str, Any]:
        configured_path = self.cli_path or os.environ.get("COPILOT_CLI_PATH", "")
        if configured_path:
            return {
                "path": configured_path,
                "available": os.path.isfile(configured_path) and os.access(configured_path, os.X_OK),
            }

        discovered_path = shutil.which("copilot")
        return {
            "path": discovered_path,
            "available": bool(discovered_path),
        }

    def _check_cli_auth_status(self, cli_resolution: Dict[str, Any]) -> Dict[str, Any]:
        cli_path = str(cli_resolution.get("path") or "").strip()
        if not cli_path or not cli_resolution.get("available"):
            return {
                "checked": False,
                "authenticated": False,
                "message": "Copilot CLI not available.",
                "version": None,
            }

        version_result = self._run_cli_command([cli_path, "--version"])
        version_text = version_result["stdout"] or version_result["stderr"] or None
        return {
            "checked": False,
            "authenticated": False,
            "message": (
                "CLI availability verified. Non-interactive auth probing is not supported here; "
                "use interactive login, COPILOT_GITHUB_TOKEN, or Azure BYOK."
            ),
            "version": version_text,
        }

    def _run_cli_command(self, command: List[str]) -> Dict[str, Any]:
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=5,
                input="n\n",
                check=False,
            )
            return {
                "returncode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
            }
        except (OSError, subprocess.TimeoutExpired) as error:
            return {
                "returncode": 1,
                "stdout": "",
                "stderr": str(error),
            }

    def _build_tools(self, planning_context: Dict[str, Any]) -> List[Any]:
        return [
            Tool(
                name=self.CONTEXT_TOOL_NAME,
                description=(
                    "Get the saved child session context, recent trend summaries, current plan draft, and therapist "
                    "request before proposing a next-session practice plan."
                ),
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
                skip_permission=True,
                handler=lambda invocation: self._get_planning_context_result(invocation, planning_context),
            ),
            Tool(
                name=self.EXERCISE_TOOL_NAME,
                description=(
                    "List candidate exercises from the exercise library filtered by focus sound and optional difficulty."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "focus_sound": {"type": "string", "description": "Speech sound or target to search for."},
                        "difficulty": {"type": "string", "description": "Optional difficulty hint."},
                        "limit": {"type": "integer", "description": "Maximum exercises to return."},
                    },
                    "required": ["focus_sound"],
                },
                skip_permission=True,
                handler=lambda invocation: self._list_candidate_exercises_result(invocation, planning_context),
            ),
        ]

    def _get_planning_context_result(self, invocation: Any, planning_context: Dict[str, Any]) -> Any:
        del invocation
        return ToolResult(
            text_result_for_llm=json.dumps(planning_context, ensure_ascii=True),
            result_type="success",
            session_log="Loaded therapist planning context",
        )

    def _list_candidate_exercises_result(self, invocation: Any, planning_context: Dict[str, Any]) -> Any:
        arguments = getattr(invocation, "arguments", None) or {}
        focus_sound = str(arguments.get("focus_sound") or "").strip()
        if not focus_sound:
            focus_sound = str(
                ((planning_context.get("source_session") or {}).get("exercise_metadata") or {}).get("target_sound") or ""
            ).strip()

        desired_difficulty = str(arguments.get("difficulty") or "").strip().lower()
        if not desired_difficulty:
            desired_difficulty = str(
                ((planning_context.get("source_session") or {}).get("exercise_metadata") or {}).get("difficulty")
                or ""
            ).strip().lower()

        raw_limit = arguments.get("limit")
        try:
            limit = max(1, min(8, int(raw_limit or 5)))
        except (TypeError, ValueError):
            limit = 5

        candidates: List[Dict[str, Any]] = []
        for scenario in self.scenario_manager.list_scenarios():
            metadata = scenario.get("exerciseMetadata") or {}
            target_sound = str(metadata.get("targetSound") or "").strip().lower()
            difficulty = str(metadata.get("difficulty") or "").strip().lower()
            score = 0

            if focus_sound and target_sound == focus_sound.lower():
                score += 3
            if desired_difficulty and difficulty == desired_difficulty:
                score += 1
            if score <= 0:
                continue

            candidates.append(
                {
                    "id": str(scenario.get("id") or "custom-guided-practice"),
                    "name": str(scenario.get("name") or "Guided practice"),
                    "description": str(scenario.get("description") or ""),
                    "exercise_metadata": metadata,
                    "match_score": score,
                }
            )

        candidates.sort(key=lambda item: item["match_score"], reverse=True)
        payload = {
            "focus_sound": focus_sound,
            "difficulty": desired_difficulty,
            "matches": candidates[:limit],
        }
        return ToolResult(
            text_result_for_llm=json.dumps(payload, ensure_ascii=True),
            result_type="success",
            session_log="Listed candidate exercises",
        )

    def _build_system_message(self) -> str:
        schema = {
            "objective": "string",
            "focus_sound": "string",
            "rationale": "string",
            "estimated_duration_minutes": "integer",
            "activities": [
                {
                    "title": "string",
                    "exercise_id": "string",
                    "exercise_name": "string",
                    "reason": "string",
                    "target_duration_minutes": "integer",
                }
            ],
            "therapist_cues": ["string"],
            "success_criteria": ["string"],
            "carryover": ["string"],
        }
        return (
            "You are a therapist planning assistant for pediatric speech sessions. "
            "Ground every recommendation in tool output. Always call get_planning_context before drafting. "
            "Use list_candidate_exercises when selecting activities. Never invent exercise ids, scores, or child facts. "
            "Return only one valid JSON object with this exact shape: "
            f"{json.dumps(schema, ensure_ascii=True)}. "
            "Do not wrap the JSON in markdown fences. Keep plans concise, therapist-facing, and actionable."
        )

    def _extract_response_content(self, response: Any) -> str:
        if response is None:
            raise RuntimeError("Copilot planner returned no response")

        data = getattr(response, "data", None)
        content = getattr(data, "content", None)
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("Copilot planner returned an empty response")
        return text

    def _extract_json_payload(self, response_content: str) -> Dict[str, Any]:
        stripped = response_content.strip()
        if stripped.startswith("```"):
            stripped = stripped.strip("`")
            stripped = stripped.replace("json\n", "", 1).strip()

        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start < 0 or end <= start:
                raise RuntimeError("Copilot planner did not return valid JSON") from None

            try:
                payload = json.loads(stripped[start : end + 1])
            except json.JSONDecodeError as error:
                raise RuntimeError("Copilot planner did not return valid JSON") from error

        if not isinstance(payload, dict):
            raise RuntimeError("Copilot planner returned JSON in an unexpected format")
        return payload

    def _validate_sdk_available(self) -> None:
        if CopilotClient is not None and PermissionRequestResult is not None:
            return

        raise RuntimeError(
            "GitHub Copilot SDK is not installed. Install 'github-copilot-sdk' and ensure the Copilot CLI is available."
        )


class PracticePlanningService:
    """Generate and refine therapist-facing practice plans with the GitHub Copilot SDK."""

    def __init__(self, storage_service: Any, scenario_manager: Any, planner_runtime: Optional[Any] = None):
        self.storage_service = storage_service
        self.scenario_manager = scenario_manager
        self.planner_runtime = planner_runtime or CopilotPlannerRuntime(storage_service, scenario_manager, config.as_dict)

    def get_readiness(self, force_refresh: bool = False) -> Dict[str, Any]:
        return self.planner_runtime.get_readiness(force_refresh=force_refresh)

    def create_plan(
        self,
        child_id: str,
        source_session_id: str,
        created_by_user_id: str,
        therapist_message: str = "",
    ) -> Dict[str, Any]:
        source_session = self.storage_service.get_session(source_session_id)
        if source_session is None:
            raise ValueError("Source session not found")

        recent_sessions = self.storage_service.list_sessions_for_child(child_id)[:5]
        child_name = self._get_child_name(source_session)
        plan_id = f"plan-{uuid4().hex[:12]}"
        planner_session_id = f"{PLANNER_SESSION_PREFIX}-{plan_id}"
        therapist_note = therapist_message.strip()
        planning_context = self._build_planning_context(
            child_id=child_id,
            source_session=source_session,
            recent_sessions=recent_sessions,
            current_plan=None,
            therapist_message=therapist_note,
        )
        turn_result = self.planner_runtime.run_turn(
            planner_session_id=planner_session_id,
            therapist_prompt=self._build_create_prompt(therapist_note),
            planning_context=planning_context,
        )
        draft = normalize_plan_draft(turn_result.draft)
        conversation = [
            {
                "role": "user",
                "content": therapist_note or DEFAULT_CREATE_MESSAGE,
            },
            {
                "role": "assistant",
                "content": self._build_assistant_summary(draft),
            },
        ]

        return self.storage_service.save_practice_plan(
            {
                "id": plan_id,
                "child_id": child_id,
                "source_session_id": source_session_id,
                "status": "draft",
                "title": f"Next session plan for {child_name}",
                "plan_type": "next_session",
                "constraints": {
                    "therapist_message": therapist_note,
                    "source_session_timestamp": source_session.get("timestamp"),
                    "copilot_sdk": {
                        "session_id": turn_result.planner_session_id,
                        "model": getattr(self.planner_runtime, "model", "gpt-5"),
                        "tool_calls_last_turn": turn_result.tool_calls,
                    },
                },
                "draft": draft,
                "conversation": conversation,
                "planner_session_id": turn_result.planner_session_id,
                "created_by_user_id": created_by_user_id,
            }
        )

    def refine_plan(self, plan_id: str, therapist_message: str) -> Dict[str, Any]:
        plan = self.storage_service.get_practice_plan(plan_id)
        if plan is None:
            raise ValueError("Practice plan not found")

        source_session_id = str(plan.get("source_session_id") or "").strip()
        source_session = self.storage_service.get_session(source_session_id)
        if source_session is None:
            raise ValueError("Source session not found")

        therapist_note = therapist_message.strip()
        recent_sessions = self.storage_service.list_sessions_for_child(plan["child_id"])[:5]
        planning_context = self._build_planning_context(
            child_id=plan["child_id"],
            source_session=source_session,
            recent_sessions=recent_sessions,
            current_plan=plan,
            therapist_message=therapist_note,
        )
        turn_result = self.planner_runtime.run_turn(
            planner_session_id=str(plan.get("planner_session_id") or f"{PLANNER_SESSION_PREFIX}-{plan_id}"),
            therapist_prompt=self._build_refine_prompt(therapist_note),
            planning_context=planning_context,
        )
        updated_draft = normalize_plan_draft(turn_result.draft)
        updated_conversation = list(plan.get("conversation") or [])
        updated_conversation.extend(
            [
                {"role": "user", "content": therapist_note},
                {"role": "assistant", "content": self._build_assistant_summary(updated_draft)},
            ]
        )
        updated_constraints = dict(plan.get("constraints") or {})
        updated_constraints["last_therapist_message"] = therapist_note
        updated_constraints["copilot_sdk"] = {
            "session_id": turn_result.planner_session_id,
            "model": getattr(self.planner_runtime, "model", "gpt-5"),
            "tool_calls_last_turn": turn_result.tool_calls,
        }

        return self.storage_service.save_practice_plan(
            {
                **plan,
                "status": "draft",
                "constraints": updated_constraints,
                "draft": updated_draft,
                "conversation": updated_conversation,
                "planner_session_id": turn_result.planner_session_id,
                "updated_at": self.storage_service._utc_now(),
            }
        )

    def _build_planning_context(
        self,
        *,
        child_id: str,
        source_session: Dict[str, Any],
        recent_sessions: List[Dict[str, Any]],
        current_plan: Optional[Dict[str, Any]],
        therapist_message: str,
    ) -> Dict[str, Any]:
        assessment = source_session.get("assessment") or {}
        ai_assessment = assessment.get("ai_assessment") or source_session.get("ai_assessment") or {}
        pronunciation = assessment.get("pronunciation_assessment") or source_session.get("pronunciation_assessment") or {}
        exercise_metadata = source_session.get("exercise_metadata") or source_session.get("exerciseMetadata") or {}
        exercise = source_session.get("exercise") or {}
        transcript = str(source_session.get("transcript") or "").strip()

        return {
            "child": {
                "id": child_id,
                "name": self._get_child_name(source_session),
            },
            "therapist_request": therapist_message,
            "source_session": {
                "id": source_session.get("id"),
                "timestamp": source_session.get("timestamp"),
                "exercise": {
                    "id": exercise.get("id"),
                    "name": exercise.get("name"),
                    "description": exercise.get("description"),
                },
                "exercise_metadata": {
                    "target_sound": exercise_metadata.get("targetSound") or exercise_metadata.get("target_sound"),
                    "difficulty": exercise_metadata.get("difficulty"),
                },
                "assessment": {
                    "overall_score": ai_assessment.get("overall_score"),
                    "practice_suggestions": ai_assessment.get("practice_suggestions") or [],
                    "willingness_to_retry": (ai_assessment.get("engagement_and_effort") or {}).get(
                        "willingness_to_retry"
                    ),
                    "accuracy_score": pronunciation.get("accuracy_score"),
                },
                "reference_text": source_session.get("reference_text"),
                "transcript_excerpt": transcript[:1600],
            },
            "recent_sessions": [self._summarize_recent_session(session) for session in recent_sessions],
            "current_plan": self._summarize_current_plan(current_plan),
        }

    def _summarize_recent_session(self, session: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": session.get("id"),
            "timestamp": session.get("timestamp"),
            "exercise_name": session.get("exercise_name") or (session.get("exercise") or {}).get("name"),
            "overall_score": session.get("overall_score"),
            "accuracy_score": session.get("accuracy_score"),
            "feedback": session.get("feedback"),
        }

    def _summarize_current_plan(self, plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not plan:
            return None

        return {
            "status": plan.get("status"),
            "draft": plan.get("draft") or {},
            "conversation": list(plan.get("conversation") or [])[-6:],
        }

    def _get_child_name(self, source_session: Dict[str, Any]) -> str:
        child = source_session.get("child") or {}
        return str(child.get("name") or source_session.get("child_name") or "the child")

    def _build_create_prompt(self, therapist_message: str) -> str:
        return (
            "Create a next-session speech therapy plan. Use the available tools to inspect the saved session context before "
            "you answer. Select activities that fit the child's recent performance and the therapist request. "
            f"Therapist request: {therapist_message or DEFAULT_CREATE_MESSAGE}"
        )

    def _build_refine_prompt(self, therapist_message: str) -> str:
        return (
            "Revise the current next-session therapy plan based on the therapist refinement request. Use the prior session "
            "history in this Copilot session and call the tools again if you need updated context. "
            f"Refinement request: {therapist_message}"
        )

    def _build_assistant_summary(self, draft: Dict[str, Any]) -> str:
        return (
            f"Prepared a {draft['estimated_duration_minutes']}-minute plan focused on {draft['focus_sound']} "
            f"with {len(draft['activities'])} activities and clear therapist cues."
        )