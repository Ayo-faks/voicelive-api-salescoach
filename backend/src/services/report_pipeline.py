"""Deterministic progress report compilation and optional summary rewrite helpers."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence, cast

from .azure_openai_auth import build_openai_client

logger = logging.getLogger(__name__)

DEFAULT_REPORT_TYPE = "progress_summary"
DEFAULT_AUDIENCE = "therapist"
VALID_AUDIENCES = {"therapist", "parent", "school"}
VALID_STATUSES = {"draft", "approved", "signed", "archived"}


class ReportSummaryAssistant(Protocol):
    def rewrite_summary(
        self,
        *,
        summary_text: str,
        audience: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        snapshot: Dict[str, Any],
    ) -> str: ...


@dataclass(frozen=True)
class ReportArtifacts:
    child: Dict[str, Any]
    audience: str
    period_start: str
    period_end: str
    included_sessions: List[Dict[str, Any]]
    summary_text: str
    snapshot: Dict[str, Any]
    sections: List[Dict[str, Any]]


def normalize_audience(audience: Optional[str]) -> str:
    normalized = str(audience or DEFAULT_AUDIENCE).strip().lower()
    if normalized not in VALID_AUDIENCES:
        raise ValueError("audience must be therapist, parent, or school")
    return normalized


def normalize_status(status: Optional[str]) -> Optional[str]:
    if status is None:
        return None
    normalized = str(status).strip().lower()
    if normalized not in VALID_STATUSES:
        raise ValueError("status must be draft, approved, signed, or archived")
    return normalized


def normalize_session_ids(included_session_ids: Any) -> List[str]:
    if not isinstance(included_session_ids, Sequence) or isinstance(included_session_ids, (str, bytes)):
        return []
    return [str(session_id).strip() for session_id in included_session_ids if str(session_id).strip()]


def as_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        normalized = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def format_date(value: Any) -> str:
    parsed = parse_iso(value)
    if parsed is None:
        return "Recent review"
    return parsed.strftime("%b %d, %Y")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def collect_target_sounds(sessions: Sequence[Dict[str, Any]]) -> List[str]:
    targets: List[str] = []
    for session in sessions:
        metadata = cast(Dict[str, Any], session.get("exercise_metadata") or {})
        target = str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip()
        if target and target not in targets:
            targets.append(target)
    return targets[:4]


def format_session_bullet(session: Dict[str, Any]) -> str:
    exercise = cast(Dict[str, Any], session.get("exercise") or {})
    exercise_name = str(exercise.get("name") or "Session").strip() or "Session"
    overall = session.get("overall_score")
    accuracy = session.get("accuracy_score")
    timestamp = format_date(session.get("timestamp"))
    metric_parts = []
    if overall is not None:
        metric_parts.append(f"overall {overall}")
    if accuracy is not None:
        metric_parts.append(f"accuracy {accuracy}")
    metrics = f" ({', '.join(metric_parts)})" if metric_parts else ""
    return f"{timestamp}: {exercise_name}{metrics}."


def format_session_metrics(session: Dict[str, Any]) -> str:
    metric_parts: List[str] = []
    if session.get("overall_score") is not None:
        metric_parts.append(f"Overall {session.get('overall_score')}")
    if session.get("accuracy_score") is not None:
        metric_parts.append(f"Accuracy {session.get('accuracy_score')}")
    if session.get("pronunciation_score") is not None:
        metric_parts.append(f"Pronunciation {session.get('pronunciation_score')}")
    return " • ".join(metric_parts) or "Saved review available"


class SessionSelectionResolver:
    def resolve_included_sessions(
        self,
        session_summaries: Sequence[Dict[str, Any]],
        *,
        included_session_ids: Optional[Sequence[str]],
        period_start: Optional[str],
        period_end: Optional[str],
        selection_provided: bool = False,
    ) -> List[Dict[str, Any]]:
        selected_ids = {str(session_id).strip() for session_id in (included_session_ids or []) if str(session_id).strip()}
        start_dt = parse_iso(period_start)
        end_dt = parse_iso(period_end)
        if start_dt is not None and end_dt is not None and start_dt > end_dt:
            raise ValueError("period_start must be before period_end")
        sessions: List[Dict[str, Any]] = []
        for session in session_summaries:
            session_id = str(session.get("id") or "").strip()
            session_dt = parse_iso(session.get("timestamp"))
            if selected_ids and session_id not in selected_ids:
                continue
            if start_dt is not None and session_dt is not None and session_dt < start_dt:
                continue
            if end_dt is not None and session_dt is not None and session_dt > end_dt:
                continue
            sessions.append(session)
        if sessions:
            return sessions
        if selection_provided or selected_ids:
            return []
        return list(session_summaries[:6])


class AzureOpenAIReportSummaryAssistant:
    def __init__(self, client: Any, model: str):
        self.client = client
        self.model = model

    @classmethod
    def from_settings(cls, settings: Mapping[str, Any]) -> Optional["AzureOpenAIReportSummaryAssistant"]:
        enabled = bool(settings.get("report_summary_rewrite_enabled"))
        if not enabled:
            return None

        client = build_openai_client(settings)
        if client is None:
            logger.warning("Report summary rewrite is enabled but Azure OpenAI is not configured")
            return None

        model = str(settings.get("report_summary_rewrite_model") or settings.get("model_deployment_name") or "").strip()
        if not model:
            logger.warning("Report summary rewrite is enabled but no model deployment name was resolved")
            return None
        return cls(client, model)

    def rewrite_summary(
        self,
        *,
        summary_text: str,
        audience: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        snapshot: Dict[str, Any],
    ) -> str:
        try:
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=self._build_messages(
                    summary_text=summary_text,
                    audience=audience,
                    child=child,
                    included_sessions=included_sessions,
                    snapshot=snapshot,
                ),
                response_format=self._get_response_format(),
                temperature=0.2,
            )
            content = completion.choices[0].message.content
            if not content:
                raise RuntimeError("AI summary rewrite returned an empty response")
            payload = json.loads(content)
            rewritten = str(payload.get("rewritten_summary") or "").strip()
            if not rewritten:
                raise RuntimeError("AI summary rewrite returned an empty summary")
            return rewritten
        except Exception as error:
            logger.exception("Failed to rewrite report summary: %s", error)
            raise RuntimeError("AI summary rewrite is unavailable right now") from error

    def _build_messages(
        self,
        *,
        summary_text: str,
        audience: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        snapshot: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        child_name = str(child.get("name") or snapshot.get("child_name") or "Child").strip() or "Child"
        session_context = [
            {
                "timestamp": session.get("timestamp"),
                "exercise_name": cast(Dict[str, Any], session.get("exercise") or {}).get("name"),
                "overall_score": session.get("overall_score"),
                "accuracy_score": session.get("accuracy_score"),
                "pronunciation_score": session.get("pronunciation_score"),
            }
            for session in included_sessions[:6]
        ]
        user_prompt = json.dumps(
            {
                "child_name": child_name,
                "audience": audience,
                "source_summary": summary_text,
                "snapshot": {
                    "session_count": snapshot.get("session_count"),
                    "focus_targets": snapshot.get("focus_targets"),
                    "average_overall_score": snapshot.get("average_overall_score"),
                    "average_accuracy_score": snapshot.get("average_accuracy_score"),
                    "average_pronunciation_score": snapshot.get("average_pronunciation_score"),
                    "plan_objective": snapshot.get("plan_objective"),
                    "top_recommendation_name": snapshot.get("top_recommendation_name"),
                },
                "sessions": session_context,
            },
            ensure_ascii=True,
        )
        return [
            {
                "role": "system",
                "content": (
                    "You rewrite therapist-authored progress report summaries for human review. "
                    "Keep the rewrite grounded only in the provided source summary and structured evidence. "
                    "Do not add diagnoses, promises, new metrics, or unsupported claims. "
                    "Return one concise paragraph in the requested audience tone."
                ),
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ]

    def _get_response_format(self) -> Dict[str, Any]:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "progress_report_summary_rewrite",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "rewritten_summary": {"type": "string"},
                    },
                    "required": ["rewritten_summary"],
                    "additionalProperties": False,
                },
            },
        }


class ReportSummaryBuilder:
    def __init__(self, summary_assistant: Optional[ReportSummaryAssistant] = None):
        self.summary_assistant = summary_assistant

    def build_title(self, child: Dict[str, Any], audience: str, period_end: str) -> str:
        child_name = str(child.get("name") or "Child").strip() or "Child"
        date_label = format_date(period_end)
        return f"{child_name} {audience.title()} Progress Report · {date_label}"

    def build_summary_text(
        self,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        audience: str,
    ) -> str:
        child_name = str(child.get("name") or "This child").strip() or "This child"
        overall_scores = [score for score in [as_float(session.get("overall_score")) for session in included_sessions] if score is not None]
        average_overall = round(mean(overall_scores), 1) if overall_scores else None
        focus_targets = collect_target_sounds(included_sessions)
        target_copy = ", ".join(focus_targets) if focus_targets else "current speech goals"
        if audience == "parent":
            if average_overall is None:
                return f"{child_name} completed {len(included_sessions)} reviewed sessions focused on {target_copy}."
            return f"{child_name} completed {len(included_sessions)} reviewed sessions focused on {target_copy}, with an average session score of {average_overall}."
        if audience == "school":
            if average_overall is None:
                return f"This report summarizes {len(included_sessions)} therapy review sessions connected to {target_copy}."
            return f"This report summarizes {len(included_sessions)} therapy review sessions connected to {target_copy}, with an average reviewed session score of {average_overall}."
        if average_overall is None:
            return f"{child_name} has {len(included_sessions)} reviewed sessions in this reporting window, focused on {target_copy}."
        return f"{child_name} has {len(included_sessions)} reviewed sessions in this reporting window, focused on {target_copy}, with an average overall score of {average_overall}."

    def rewrite_summary_text(
        self,
        *,
        summary_text: str,
        audience: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        snapshot: Dict[str, Any],
    ) -> str:
        if self.summary_assistant is None:
            raise RuntimeError("AI summary rewrite is not configured")
        rewritten = str(
            self.summary_assistant.rewrite_summary(
                summary_text=summary_text,
                audience=audience,
                child=child,
                included_sessions=included_sessions,
                snapshot=snapshot,
            )
        ).strip()
        return rewritten or summary_text


class SnapshotBuilder:
    def __init__(self, storage_service: Any):
        self.storage_service = storage_service

    def build_snapshot(
        self,
        child_id: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        overall_scores = [score for score in [as_float(session.get("overall_score")) for session in included_sessions] if score is not None]
        accuracy_scores = [score for score in [as_float(session.get("accuracy_score")) for session in included_sessions] if score is not None]
        pronunciation_scores = [
            score for score in [as_float(session.get("pronunciation_score")) for session in included_sessions] if score is not None
        ]
        target_sounds = collect_target_sounds(included_sessions)
        child_memory_summary = self.storage_service.get_child_memory_summary(child_id) or {}
        plans = self.storage_service.list_practice_plans_for_child(child_id)
        recommendation_logs = self.storage_service.list_recommendation_logs_for_child(child_id, limit=3)
        latest_plan = next((plan for plan in plans if str(plan.get("status") or "") == "approved"), plans[0] if plans else None)
        latest_recommendation = recommendation_logs[0] if recommendation_logs else None
        top_recommendation_name = None
        top_recommendation_rationale = None
        if latest_recommendation is not None:
            candidates = self.storage_service.list_recommendation_candidates(str(latest_recommendation.get("id") or ""))
            if candidates:
                top_recommendation_name = candidates[0].get("exercise_name")
                top_recommendation_rationale = candidates[0].get("rationale")

        return {
            "child_name": child.get("name"),
            "generated_at": utc_now(),
            "session_count": len(included_sessions),
            "latest_session_at": included_sessions[0].get("timestamp") if included_sessions else None,
            "average_overall_score": round(mean(overall_scores), 1) if overall_scores else None,
            "average_accuracy_score": round(mean(accuracy_scores), 1) if accuracy_scores else None,
            "average_pronunciation_score": round(mean(pronunciation_scores), 1) if pronunciation_scores else None,
            "focus_targets": target_sounds,
            "memory_summary_text": child_memory_summary.get("summary_text"),
            "memory_source_item_count": child_memory_summary.get("source_item_count"),
            "plan_title": latest_plan.get("title") if latest_plan else None,
            "plan_status": latest_plan.get("status") if latest_plan else None,
            "plan_objective": cast(Dict[str, Any], latest_plan.get("draft") or {}).get("objective") if latest_plan else None,
            "top_recommendation_name": top_recommendation_name,
            "top_recommendation_rationale": top_recommendation_rationale,
        }


class SectionBuilder:
    def build_sections(
        self,
        *,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        audience: str,
        snapshot: Dict[str, Any],
        overview_narrative: str,
    ) -> List[Dict[str, Any]]:
        child_name = str(child.get("name") or "This child").strip() or "This child"
        session_bullets = [format_session_bullet(session) for session in included_sessions[:4]]
        focus_targets = cast(List[str], snapshot.get("focus_targets") or [])
        target_copy = ", ".join(focus_targets) if focus_targets else "current speech goals"
        plan_objective = str(snapshot.get("plan_objective") or "").strip()
        plan_title = str(snapshot.get("plan_title") or "").strip()
        recommendation_name = str(snapshot.get("top_recommendation_name") or "").strip()
        recommendation_rationale = str(snapshot.get("top_recommendation_rationale") or "").strip()
        summary_text = str(snapshot.get("memory_summary_text") or "").strip()
        metrics = self._build_metric_items(snapshot)

        common_sections: List[Dict[str, Any]] = [
            {
                "key": "overview",
                "title": "Overview",
                "narrative": overview_narrative,
                "metrics": metrics,
            },
            {
                "key": "session-highlights",
                "title": "Session highlights",
                "bullets": session_bullets,
            },
        ]

        if audience == "therapist":
            common_sections.extend(
                [
                    {
                        "key": "clinical-focus",
                        "title": "Clinical focus",
                        "bullets": [
                            f"Primary focus across the reporting window: {target_copy}.",
                            summary_text or f"{child_name} benefits from therapist review notes and approved child memory to guide the next session.",
                            plan_objective or (f"Latest approved plan: {plan_title}." if plan_title else "No approved practice plan is attached yet."),
                        ],
                    },
                    {
                        "key": "next-steps",
                        "title": "Next steps",
                        "bullets": [
                            f"Continue shaping treatment around {target_copy}.",
                            recommendation_rationale or (f"Most recent recommendation: {recommendation_name}." if recommendation_name else "Generate a fresh recommendation run before the next visit."),
                        ],
                    },
                ]
            )
        elif audience == "parent":
            common_sections.extend(
                [
                    {
                        "key": "family-wins",
                        "title": "What is going well",
                        "bullets": [
                            f"{child_name} completed {len(included_sessions)} reviewed practice session(s) in this period.",
                            f"Current speech focus: {target_copy}.",
                            summary_text or "Therapist notes show growing familiarity with the current speech target.",
                        ],
                    },
                    {
                        "key": "home-support",
                        "title": "How to support at home",
                        "bullets": [
                            plan_objective or "Repeat short, successful practice moments instead of long drills.",
                            recommendation_name and recommendation_rationale
                            and f"A useful next activity is {recommendation_name}: {recommendation_rationale}"
                            or "Keep practice brief, positive, and connected to daily routines.",
                        ],
                    },
                ]
            )
        else:
            common_sections.extend(
                [
                    {
                        "key": "school-impact",
                        "title": "School participation impact",
                        "bullets": [
                            f"Current speech focus relevant to school communication: {target_copy}.",
                            summary_text or f"{child_name} benefits from clear models and predictable speaking routines.",
                        ],
                    },
                    {
                        "key": "classroom-support",
                        "title": "Suggested classroom supports",
                        "bullets": [
                            "Allow short response windows and calm repetition when needed.",
                            plan_objective or "Reinforce successful speech attempts during structured speaking tasks.",
                            recommendation_name and f"Coordinate with therapy on activities similar to {recommendation_name}." or "Coordinate with the therapist on carryover activities.",
                        ],
                    },
                ]
            )

        return common_sections

    def _build_metric_items(self, snapshot: Dict[str, Any]) -> List[Dict[str, str]]:
        items: List[Dict[str, str]] = []
        for label, key in (
            ("Reviewed sessions", "session_count"),
            ("Average overall", "average_overall_score"),
            ("Average accuracy", "average_accuracy_score"),
            ("Average pronunciation", "average_pronunciation_score"),
        ):
            value = snapshot.get(key)
            items.append({"label": label, "value": "—" if value is None else str(value)})
        return items


class ReportCompilationPipeline:
    def __init__(
        self,
        *,
        storage_service: Any,
        session_resolver: SessionSelectionResolver,
        summary_builder: ReportSummaryBuilder,
        snapshot_builder: SnapshotBuilder,
        section_builder: SectionBuilder,
    ):
        self.storage_service = storage_service
        self.session_resolver = session_resolver
        self.summary_builder = summary_builder
        self.snapshot_builder = snapshot_builder
        self.section_builder = section_builder

    def build_report_artifacts(
        self,
        *,
        child_id: str,
        audience: str,
        period_start: Optional[str],
        period_end: Optional[str],
        included_session_ids: Optional[Sequence[str]],
    ) -> ReportArtifacts:
        child = self.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("Child not found")

        normalized_audience = normalize_audience(audience)
        normalized_session_ids = normalize_session_ids(included_session_ids)
        selection_provided = included_session_ids is not None
        if selection_provided and not normalized_session_ids:
            raise ValueError("At least one session must be selected for the report")

        session_summaries = self.storage_service.list_sessions_for_child(child_id)
        included_sessions = self.session_resolver.resolve_included_sessions(
            session_summaries,
            included_session_ids=normalized_session_ids,
            period_start=period_start,
            period_end=period_end,
            selection_provided=selection_provided,
        )
        if not included_sessions:
            if selection_provided or period_start or period_end:
                raise ValueError("No saved sessions matched the selected report window")
            raise ValueError("At least one saved session is required before creating a progress report")

        resolved_period_start = period_start or str(included_sessions[-1].get("timestamp") or "")
        resolved_period_end = period_end or str(included_sessions[0].get("timestamp") or "")
        summary_text = self.summary_builder.build_summary_text(child, included_sessions, normalized_audience)
        snapshot = self.snapshot_builder.build_snapshot(child_id, child, included_sessions)
        sections = self.section_builder.build_sections(
            child=child,
            included_sessions=included_sessions,
            audience=normalized_audience,
            snapshot=snapshot,
            overview_narrative=summary_text,
        )

        return ReportArtifacts(
            child=child,
            audience=normalized_audience,
            period_start=resolved_period_start,
            period_end=resolved_period_end,
            included_sessions=list(included_sessions),
            summary_text=summary_text,
            snapshot=snapshot,
            sections=sections,
        )