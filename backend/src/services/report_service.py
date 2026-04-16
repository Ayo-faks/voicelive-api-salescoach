"""Therapist-facing child progress reports built from saved review artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from io import BytesIO
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional, Sequence, cast
from uuid import uuid4

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    REPORTLAB_AVAILABLE = True
except ImportError:
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None
    REPORTLAB_AVAILABLE = False


DEFAULT_REPORT_TYPE = "progress_summary"
DEFAULT_AUDIENCE = "therapist"
VALID_AUDIENCES = {"therapist", "parent", "school"}
VALID_STATUSES = {"draft", "approved", "signed", "archived"}
REDACTION_HIDE_SUMMARY_TEXT = "hide_summary_text"
REDACTION_HIDE_OVERVIEW_METRICS = "hide_overview_metrics"
REDACTION_HIDE_SESSION_LIST = "hide_session_list"
REDACTION_HIDE_INTERNAL_METADATA = "hide_internal_metadata"
REDACTION_HIDDEN_SECTION_KEYS = "hidden_section_keys"
DEFAULT_REDACTION_OVERRIDES = {
    REDACTION_HIDE_SUMMARY_TEXT: False,
    REDACTION_HIDE_OVERVIEW_METRICS: False,
    REDACTION_HIDE_SESSION_LIST: False,
    REDACTION_HIDE_INTERNAL_METADATA: False,
    REDACTION_HIDDEN_SECTION_KEYS: [],
}
INTERNAL_METADATA_CARD_LABELS = {"Audience", "Status", "Generated"}


class ProgressReportService:
    def __init__(self, storage_service: Any):
        self.storage_service = storage_service

    def list_reports(
        self,
        child_id: str,
        *,
        status: Optional[str] = None,
        audience: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        normalized_status = self._normalize_status(status)
        normalized_audience = self._normalize_audience(audience) if audience else None
        return self.storage_service.list_progress_reports_for_child(
            child_id,
            status=normalized_status,
            audience=normalized_audience,
            limit=limit,
        )

    def get_report(self, report_id: str) -> Dict[str, Any]:
        report = self.storage_service.get_progress_report(report_id)
        if report is None:
            raise ValueError("Progress report not found")
        return report

    def render_report_html(self, report_id: str) -> str:
        return self._render_report_html_document(self._build_export_context(report_id))

    def render_report_pdf(self, report_id: str) -> bytes:
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError("PDF export is unavailable until the reportlab dependency is installed")
        return self._render_report_pdf_document(self._build_export_context(report_id))

    def create_report(
        self,
        *,
        child_id: str,
        created_by_user_id: str,
        audience: str,
        title: Optional[str] = None,
        report_type: str = DEFAULT_REPORT_TYPE,
        period_start: Optional[str] = None,
        period_end: Optional[str] = None,
        included_session_ids: Optional[Sequence[str]] = None,
        summary_text: Optional[str] = None,
        redaction_overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        artifacts = self._build_report_artifacts(
            child_id=child_id,
            audience=audience,
            period_start=period_start,
            period_end=period_end,
            included_session_ids=included_session_ids,
        )
        child = cast(Dict[str, Any], artifacts["child"])
        normalized_audience = str(artifacts["audience"])
        resolved_period_start = str(artifacts["period_start"])
        resolved_period_end = str(artifacts["period_end"])
        generated_summary = str(artifacts["summary_text"])
        snapshot = cast(Dict[str, Any], artifacts["snapshot"])
        sections = cast(List[Dict[str, Any]], artifacts["sections"])
        included_sessions = cast(List[Dict[str, Any]], artifacts["included_sessions"])

        return self.storage_service.save_progress_report(
            {
                "id": f"report-{uuid4().hex[:12]}",
                "child_id": child_id,
                "workspace_id": child.get("workspace_id"),
                "created_by_user_id": created_by_user_id,
                "audience": normalized_audience,
                "report_type": str(report_type or DEFAULT_REPORT_TYPE),
                "title": title or self._build_title(child, normalized_audience, resolved_period_end),
                "status": "draft",
                "period_start": resolved_period_start,
                "period_end": resolved_period_end,
                "included_session_ids": [str(session.get("id") or "") for session in included_sessions if session.get("id")],
                "snapshot": snapshot,
                "sections": sections,
                "redaction_overrides": redaction_overrides or {},
                "summary_text": summary_text or generated_summary,
            }
        )

    def update_report(
        self,
        report_id: str,
        *,
        audience: Optional[str] = None,
        title: Optional[str] = None,
        period_start: Optional[str] = None,
        period_end: Optional[str] = None,
        included_session_ids: Optional[Sequence[str]] = None,
        summary_text: Optional[str] = None,
        sections: Optional[List[Dict[str, Any]]] = None,
        redaction_overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        report = self.storage_service.get_progress_report(report_id)
        if report is None:
            raise ValueError("Progress report not found")
        if str(report.get("status") or "draft") != "draft":
            raise ValueError("Only draft reports can be updated")

        child_id = str(report.get("child_id") or "")
        child = self.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("Child not found")

        current_audience = self._normalize_audience(report.get("audience"))
        current_period_start = str(report.get("period_start") or "") or None
        current_period_end = str(report.get("period_end") or "") or None
        current_session_ids = self._normalize_session_ids(report.get("included_session_ids"))
        current_sections = cast(List[Dict[str, Any]], report.get("sections") or [])
        current_snapshot = cast(Dict[str, Any], report.get("snapshot") or {})
        current_redaction_overrides = cast(Dict[str, Any], report.get("redaction_overrides") or {})

        normalized_audience = self._normalize_audience(audience) if audience is not None else current_audience
        normalized_session_ids = self._normalize_session_ids(included_session_ids) if included_session_ids is not None else current_session_ids
        if included_session_ids is not None and not normalized_session_ids:
            raise ValueError("At least one session must be selected for the report")

        effective_period_start = period_start if period_start is not None else current_period_start
        effective_period_end = period_end if period_end is not None else current_period_end
        context_changed = (
            normalized_audience != current_audience
            or effective_period_start != current_period_start
            or effective_period_end != current_period_end
            or normalized_session_ids != current_session_ids
        )

        title_value = report.get("title") if title is None else title
        summary_value = report.get("summary_text") if summary_text is None else summary_text
        sections_value = current_sections if sections is None else sections
        snapshot_value = current_snapshot
        period_start_value = current_period_start or ""
        period_end_value = current_period_end or ""
        included_session_ids_value = current_session_ids

        if context_changed:
            previous_sessions = self._resolve_included_sessions(
                self.storage_service.list_sessions_for_child(child_id),
                included_session_ids=current_session_ids,
                period_start=current_period_start,
                period_end=current_period_end,
                selection_provided=bool(current_session_ids),
            )
            previous_generated_title = self._build_title(child, current_audience, period_end_value)
            previous_generated_summary = self._build_summary_text(child, previous_sessions, current_audience) if previous_sessions else None

            artifacts = self._build_report_artifacts(
                child_id=child_id,
                audience=normalized_audience,
                period_start=effective_period_start,
                period_end=effective_period_end,
                included_session_ids=normalized_session_ids,
            )

            generated_title = self._build_title(child, normalized_audience, str(artifacts["period_end"]))
            generated_summary = str(artifacts["summary_text"])
            if title is None and str(report.get("title") or "") == previous_generated_title:
                title_value = generated_title
            if summary_text is None and previous_generated_summary is not None and str(report.get("summary_text") or "") == previous_generated_summary:
                summary_value = generated_summary
            snapshot_value = cast(Dict[str, Any], artifacts["snapshot"])
            sections_value = cast(List[Dict[str, Any]], artifacts["sections"]) if sections is None else sections
            period_start_value = str(artifacts["period_start"])
            period_end_value = str(artifacts["period_end"])
            included_session_ids_value = [
                str(session.get("id") or "")
                for session in cast(List[Dict[str, Any]], artifacts["included_sessions"])
                if session.get("id")
            ]

        updated = self.storage_service.update_progress_report(
            report_id,
            {
                "audience": normalized_audience,
                "title": title_value,
                "period_start": period_start_value,
                "period_end": period_end_value,
                "included_session_ids": included_session_ids_value,
                "snapshot": snapshot_value,
                "sections": sections_value,
                "redaction_overrides": current_redaction_overrides if redaction_overrides is None else redaction_overrides,
                "summary_text": summary_value,
            },
        )
        if updated is None:
            raise ValueError("Progress report not found")
        return updated

    def approve_report(self, report_id: str) -> Dict[str, Any]:
        report = self.get_report(report_id)
        if str(report.get("status") or "draft") != "draft":
            raise ValueError("Only draft reports can be approved")
        approved = self.storage_service.approve_progress_report(report_id)
        if approved is None:
            raise ValueError("Progress report not found")
        return approved

    def sign_report(self, report_id: str, signed_by_user_id: str) -> Dict[str, Any]:
        report = self.get_report(report_id)
        if str(report.get("status") or "") not in {"approved", "signed"}:
            raise ValueError("Only approved reports can be signed")
        signed = self.storage_service.sign_progress_report(report_id, signed_by_user_id)
        if signed is None:
            raise ValueError("Progress report not found")
        return signed

    def archive_report(self, report_id: str) -> Dict[str, Any]:
        report = self.get_report(report_id)
        if str(report.get("status") or "") not in {"approved", "signed"}:
            raise ValueError("Only approved or signed reports can be archived")
        archived = self.storage_service.archive_progress_report(report_id)
        if archived is None:
            raise ValueError("Progress report not found")
        return archived

    def _normalize_audience(self, audience: Optional[str]) -> str:
        normalized = str(audience or DEFAULT_AUDIENCE).strip().lower()
        if normalized not in VALID_AUDIENCES:
            raise ValueError("audience must be therapist, parent, or school")
        return normalized

    def _normalize_status(self, status: Optional[str]) -> Optional[str]:
        if status is None:
            return None
        normalized = str(status).strip().lower()
        if normalized not in VALID_STATUSES:
            raise ValueError("status must be draft, approved, signed, or archived")
        return normalized

    def _normalize_session_ids(self, included_session_ids: Any) -> List[str]:
        if not isinstance(included_session_ids, Sequence) or isinstance(included_session_ids, (str, bytes)):
            return []
        return [str(session_id).strip() for session_id in included_session_ids if str(session_id).strip()]

    def _build_report_artifacts(
        self,
        *,
        child_id: str,
        audience: str,
        period_start: Optional[str],
        period_end: Optional[str],
        included_session_ids: Optional[Sequence[str]],
    ) -> Dict[str, Any]:
        child = self.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("Child not found")

        normalized_audience = self._normalize_audience(audience)
        normalized_session_ids = self._normalize_session_ids(included_session_ids)
        selection_provided = included_session_ids is not None
        if selection_provided and not normalized_session_ids:
            raise ValueError("At least one session must be selected for the report")

        session_summaries = self.storage_service.list_sessions_for_child(child_id)
        included_sessions = self._resolve_included_sessions(
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
        generated_summary = self._build_summary_text(child, included_sessions, normalized_audience)
        snapshot = self._build_snapshot(child_id, child, included_sessions)
        sections = self._build_sections(
            child=child,
            included_sessions=included_sessions,
            audience=normalized_audience,
            snapshot=snapshot,
        )

        return {
            "child": child,
            "audience": normalized_audience,
            "period_start": resolved_period_start,
            "period_end": resolved_period_end,
            "included_sessions": included_sessions,
            "summary_text": generated_summary,
            "snapshot": snapshot,
            "sections": sections,
        }

    def _resolve_included_sessions(
        self,
        session_summaries: Sequence[Dict[str, Any]],
        *,
        included_session_ids: Optional[Sequence[str]],
        period_start: Optional[str],
        period_end: Optional[str],
        selection_provided: bool = False,
    ) -> List[Dict[str, Any]]:
        selected_ids = {str(session_id).strip() for session_id in (included_session_ids or []) if str(session_id).strip()}
        start_dt = self._parse_iso(period_start)
        end_dt = self._parse_iso(period_end)
        if start_dt is not None and end_dt is not None and start_dt > end_dt:
            raise ValueError("period_start must be before period_end")
        sessions: List[Dict[str, Any]] = []
        for session in session_summaries:
            session_id = str(session.get("id") or "").strip()
            session_dt = self._parse_iso(session.get("timestamp"))
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

    def _build_export_context(self, report_id: str) -> Dict[str, Any]:
        report = self.get_report(report_id)
        child_id = str(report.get("child_id") or "")
        snapshot = cast(Dict[str, Any], report.get("snapshot") or {})
        child = self.storage_service.get_child(child_id) or {"name": snapshot.get("child_name")}
        session_summaries = self.storage_service.list_sessions_for_child(child_id)
        included_session_ids = self._normalize_session_ids(report.get("included_session_ids"))
        included_sessions = self._resolve_included_sessions(
            session_summaries,
            included_session_ids=included_session_ids,
            period_start=str(report.get("period_start") or "") or None,
            period_end=str(report.get("period_end") or "") or None,
            selection_provided=bool(included_session_ids),
        )
        redaction_overrides = self._normalize_redaction_overrides(report.get("redaction_overrides"))
        child_name = str(snapshot.get("child_name") or child.get("name") or "Child").strip() or "Child"
        focus_target_list = cast(List[str], snapshot.get("focus_targets") or [])
        focus_targets = ", ".join(focus_target_list) or "No tagged target sound"
        metric_cards = [
            ("Audience", str(report.get("audience") or DEFAULT_AUDIENCE).title()),
            ("Status", str(report.get("status") or "draft").title()),
            ("Report window", f"{self._format_date(report.get('period_start'))} to {self._format_date(report.get('period_end'))}"),
            ("Reviewed sessions", str(snapshot.get("session_count") or len(included_sessions) or 0)),
            ("Focus targets", focus_targets),
            ("Generated", self._format_date(snapshot.get("generated_at") or report.get("updated_at"))),
        ]
        if redaction_overrides[REDACTION_HIDE_INTERNAL_METADATA]:
            metric_cards = [
                (label, value)
                for label, value in metric_cards
                if label not in INTERNAL_METADATA_CARD_LABELS
            ]

        badges: List[str] = []
        if not redaction_overrides[REDACTION_HIDE_INTERNAL_METADATA]:
            badges.extend(
                [
                    f"{str(report.get('audience') or DEFAULT_AUDIENCE).title()} audience",
                    str(report.get("status") or "draft").title(),
                ]
            )
        if focus_target_list:
            badges.append(focus_targets)

        sections = self._filter_sections_for_export(cast(List[Dict[str, Any]], report.get("sections") or []), redaction_overrides)
        if not sections:
            sections = [
                {
                    "key": "export-view",
                    "title": "Export view",
                    "narrative": "All shareable sections are currently hidden for this export.",
                }
            ]

        return {
            "report": report,
            "child_name": child_name,
            "subtitle": f"{child_name} • {str(report.get('report_type') or DEFAULT_REPORT_TYPE).replace('_', ' ')}",
            "summary_text": str(report.get("summary_text") or "").strip() or "No summary note has been saved for this report yet.",
            "metric_cards": metric_cards,
            "included_sessions": included_sessions,
            "sections": sections,
            "badges": badges,
            "show_summary_text": not redaction_overrides[REDACTION_HIDE_SUMMARY_TEXT],
            "show_overview_metrics": not redaction_overrides[REDACTION_HIDE_OVERVIEW_METRICS] and bool(metric_cards),
            "show_session_list": not redaction_overrides[REDACTION_HIDE_SESSION_LIST],
            "redaction_notice": self._build_redaction_notice(redaction_overrides),
        }

    def _normalize_redaction_overrides(self, overrides: Any) -> Dict[str, Any]:
        normalized = dict(DEFAULT_REDACTION_OVERRIDES)
        if not isinstance(overrides, dict):
            return normalized

        for key in (
            REDACTION_HIDE_SUMMARY_TEXT,
            REDACTION_HIDE_OVERVIEW_METRICS,
            REDACTION_HIDE_SESSION_LIST,
            REDACTION_HIDE_INTERNAL_METADATA,
        ):
            normalized[key] = bool(overrides.get(key))

        hidden_section_keys = overrides.get(REDACTION_HIDDEN_SECTION_KEYS)
        if isinstance(hidden_section_keys, Sequence) and not isinstance(hidden_section_keys, (str, bytes)):
            normalized[REDACTION_HIDDEN_SECTION_KEYS] = [
                str(section_key).strip()
                for section_key in hidden_section_keys
                if str(section_key).strip()
            ]
        return normalized

    def _filter_sections_for_export(
        self,
        sections: Sequence[Dict[str, Any]],
        redaction_overrides: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        hidden_section_keys = set(cast(List[str], redaction_overrides.get(REDACTION_HIDDEN_SECTION_KEYS) or []))
        filtered_sections: List[Dict[str, Any]] = []

        for section in sections:
            section_key = str(section.get("key") or "").strip()
            if section_key and section_key in hidden_section_keys:
                continue

            section_copy = dict(section)
            if redaction_overrides[REDACTION_HIDE_OVERVIEW_METRICS]:
                section_copy["metrics"] = []
            filtered_sections.append(section_copy)

        return filtered_sections

    def _build_redaction_notice(self, redaction_overrides: Dict[str, Any]) -> Optional[str]:
        hidden_parts: List[str] = []
        if redaction_overrides[REDACTION_HIDE_SUMMARY_TEXT]:
            hidden_parts.append("the executive summary")
        if redaction_overrides[REDACTION_HIDE_OVERVIEW_METRICS]:
            hidden_parts.append("overview metrics")
        if redaction_overrides[REDACTION_HIDE_SESSION_LIST]:
            hidden_parts.append("the included-session list")
        if redaction_overrides[REDACTION_HIDE_INTERNAL_METADATA]:
            hidden_parts.append("internal workflow metadata")

        hidden_section_count = len(cast(List[str], redaction_overrides.get(REDACTION_HIDDEN_SECTION_KEYS) or []))
        if hidden_section_count:
            hidden_parts.append(f"{hidden_section_count} hidden section(s)")

        if not hidden_parts:
            return None
        if len(hidden_parts) == 1:
            return f"This shared export hides {hidden_parts[0]}."
        return f"This shared export hides {', '.join(hidden_parts[:-1])}, and {hidden_parts[-1]}."

    def _render_report_html_document(
        self,
        export_context: Dict[str, Any],
    ) -> str:
        report = cast(Dict[str, Any], export_context["report"])
        child_name = str(export_context["child_name"])
        summary_text = str(export_context["summary_text"])
        metric_cards = cast(List[tuple[str, str]], export_context["metric_cards"])
        included_sessions = cast(List[Dict[str, Any]], export_context["included_sessions"])
        sections = cast(List[Dict[str, Any]], export_context["sections"])
        badges = cast(List[str], export_context["badges"])
        show_summary_text = bool(export_context["show_summary_text"])
        show_overview_metrics = bool(export_context["show_overview_metrics"])
        show_session_list = bool(export_context["show_session_list"])
        redaction_notice = cast(Optional[str], export_context.get("redaction_notice"))
        session_items_html = "".join(
            f"<li><span class=\"session-date\">{escape(self._format_date(session.get('timestamp')))}</span><strong>{escape(str(cast(Dict[str, Any], session.get('exercise') or {}).get('name') or 'Saved session'))}</strong><span>{escape(self._format_session_metrics(session))}</span></li>"
            for session in included_sessions
        ) or "<li><strong>No saved sessions were available when this export was generated.</strong></li>"
        section_blocks_html = "".join(self._render_section_html(section) for section in sections)
        badge_html = "".join(f"<span class=\"badge\">{escape(badge)}</span>" for badge in badges)
        summary_html = (
            f"<div class=\"summary\"><p class=\"summary-title\">Executive summary</p><p class=\"summary-text\">{escape(summary_text)}</p></div>"
            if show_summary_text
            else ""
        )
        metrics_html = (
            f"<div class=\"metrics\">{''.join(f'<div class=\"metric-card\"><p class=\"metric-label\">{escape(label)}</p><p class=\"metric-value\">{escape(value)}</p></div>' for label, value in metric_cards)}</div>"
            if show_overview_metrics
            else ""
        )
        session_panel_html = (
            f"<aside class=\"panel\"><h2>Included sessions</h2><ol class=\"session-list\">{session_items_html}</ol></aside>"
            if show_session_list
            else ""
        )
        footer_notice_html = f"<p class=\"footer\">{escape(redaction_notice)}</p>" if redaction_notice else ""
        content_grid_class = "content-grid" if show_session_list else "content-grid single-column"

        return f"""<!doctype html>
<html lang=\"en\">
    <head>
        <meta charset=\"utf-8\" />
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <title>{escape(str(report.get('title') or 'Progress report'))}</title>
        <style>
            @page {{
                size: A4;
                margin: 14mm;
            }}

            :root {{
                color-scheme: light;
                --ink: #16303c;
                --muted: #56717c;
                --line: #d9e2e6;
                --surface: #f7fbfc;
                --surface-strong: #eef5f6;
                --accent: #127a72;
                --accent-soft: rgba(18, 122, 114, 0.12);
            }}

            * {{ box-sizing: border-box; }}
            body {{
                margin: 0;
                font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
                color: var(--ink);
                background: white;
            }}
            .page {{
                max-width: 940px;
                margin: 0 auto;
            }}
            .toolbar {{
                display: flex;
                justify-content: flex-end;
                margin-bottom: 18px;
            }}
            .print-button {{
                border: 0;
                background: var(--accent);
                color: white;
                padding: 10px 16px;
                border-radius: 999px;
                font-weight: 600;
                cursor: pointer;
            }}
            .hero {{
                padding: 28px;
                border: 1px solid var(--line);
                background: linear-gradient(135deg, #fbfdfd, #f1f7f8);
            }}
            .eyebrow {{
                color: var(--muted);
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.12em;
                font-weight: 700;
            }}
            h1 {{
                margin: 10px 0 8px;
                font-size: 32px;
                line-height: 1.1;
            }}
            .subtitle {{
                margin: 0;
                color: var(--muted);
                font-size: 15px;
                line-height: 1.6;
            }}
            .badge-row {{
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 18px;
            }}
            .badge {{
                display: inline-flex;
                align-items: center;
                padding: 6px 12px;
                border-radius: 999px;
                background: var(--accent-soft);
                color: var(--accent);
                font-size: 12px;
                font-weight: 700;
            }}
            .summary {{
                margin-top: 18px;
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
            }}
            .summary-title {{
                margin: 0 0 8px;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: var(--muted);
                font-weight: 700;
            }}
            .summary-text {{
                margin: 0;
                font-size: 15px;
                line-height: 1.7;
            }}
            .metrics {{
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 12px;
                margin-top: 18px;
            }}
            .metric-card {{
                padding: 14px;
                border: 1px solid var(--line);
                background: var(--surface);
                min-height: 92px;
            }}
            .metric-label {{
                margin: 0 0 8px;
                color: var(--muted);
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-weight: 700;
            }}
            .metric-value {{
                margin: 0;
                font-size: 18px;
                line-height: 1.35;
                font-weight: 700;
            }}
            .content-grid {{
                display: grid;
                grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
                gap: 18px;
                margin-top: 18px;
            }}
            .content-grid.single-column {{
                grid-template-columns: 1fr;
            }}
            .panel {{
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
            }}
            .panel h2 {{
                margin: 0 0 12px;
                font-size: 18px;
            }}
            .session-list {{
                margin: 0;
                padding-left: 18px;
                display: grid;
                gap: 12px;
            }}
            .session-list li {{
                break-inside: avoid;
            }}
            .session-list strong {{
                display: block;
                margin: 4px 0;
            }}
            .session-date {{
                color: var(--muted);
                font-size: 12px;
            }}
            .section {{
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
                break-inside: avoid;
            }}
            .section + .section {{
                margin-top: 14px;
            }}
            .section h3 {{
                margin: 0 0 12px;
                font-size: 18px;
            }}
            .section p {{
                margin: 0;
                line-height: 1.7;
            }}
            .section ul {{
                margin: 12px 0 0;
                padding-left: 18px;
                display: grid;
                gap: 8px;
            }}
            .section-metrics {{
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
                margin-top: 12px;
            }}
            .section-metric {{
                padding: 12px;
                border: 1px solid var(--line);
                background: var(--surface-strong);
            }}
            .section-metric-label {{
                display: block;
                font-size: 12px;
                color: var(--muted);
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-weight: 700;
            }}
            .section-metric-value {{
                font-size: 17px;
                font-weight: 700;
            }}
            .footer {{
                margin-top: 18px;
                color: var(--muted);
                font-size: 12px;
                line-height: 1.6;
            }}
            @media (max-width: 760px) {{
                .metrics,
                .content-grid,
                .section-metrics {{
                    grid-template-columns: 1fr;
                }}
            }}
            @media print {{
                .toolbar {{ display: none; }}
                body {{ background: white; }}
                .page {{ max-width: none; }}
            }}
        </style>
    </head>
    <body>
        <main class=\"page\">
            <div class=\"toolbar\">
                <button class=\"print-button\" type=\"button\" onclick=\"window.print()\">Print or save as PDF</button>
            </div>

            <section class=\"hero\">
                <div class=\"eyebrow\">Wulo progress report</div>
                <h1>{escape(str(report.get('title') or 'Progress report'))}</h1>
                <p class=\"subtitle\">{escape(str(export_context['subtitle']))}</p>

                {f'<div class=\"badge-row\">{badge_html}</div>' if badge_html else ''}
                {summary_html}
                {metrics_html}
            </section>

            <section class=\"{content_grid_class}\">
                {session_panel_html}
                <div>{section_blocks_html}</div>
            </section>

            <p class=\"footer\">This document summarizes therapist-reviewed Wulo practice data. It supports supervision, family communication, and school coordination, but it does not replace clinical judgment or diagnosis.</p>
            {footer_notice_html}
        </main>
    </body>
</html>
"""

    def _render_report_pdf_document(self, export_context: Dict[str, Any]) -> bytes:
        report = cast(Dict[str, Any], export_context["report"])
        metric_cards = cast(List[tuple[str, str]], export_context["metric_cards"])
        included_sessions = cast(List[Dict[str, Any]], export_context["included_sessions"])
        sections = cast(List[Dict[str, Any]], export_context["sections"])
        badges = cast(List[str], export_context["badges"])
        show_summary_text = bool(export_context["show_summary_text"])
        show_overview_metrics = bool(export_context["show_overview_metrics"])
        show_session_list = bool(export_context["show_session_list"])
        redaction_notice = cast(Optional[str], export_context.get("redaction_notice"))

        buffer = BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            topMargin=16 * mm,
            bottomMargin=16 * mm,
            title=str(report.get("title") or "Progress report"),
        )
        styles = self._build_pdf_styles()
        story: List[Any] = [
            Paragraph("WULO PROGRESS REPORT", styles["ReportEyebrow"]),
            Paragraph(self._pdf_text(str(report.get("title") or "Progress report")), styles["ReportTitle"]),
            Paragraph(self._pdf_text(str(export_context["subtitle"])), styles["ReportSubtitle"]),
        ]

        if badges:
            story.extend(
                [
                    Spacer(1, 6),
                    Paragraph(self._pdf_text(" • ".join(badges)), styles["ReportBadges"]),
                ]
            )

        if show_summary_text:
            story.extend(
                [
                    Spacer(1, 14),
                    Paragraph("Executive summary", styles["ReportSectionLabel"]),
                    Paragraph(self._pdf_text(str(export_context["summary_text"])), styles["ReportBody"]),
                ]
            )

        if show_overview_metrics:
            story.extend(
                [
                    Spacer(1, 14),
                    Paragraph("Overview metrics", styles["ReportSectionLabel"]),
                    self._build_pdf_metric_table(metric_cards, styles, document.width),
                ]
            )

        if show_session_list:
            story.extend(
                [
                    Spacer(1, 16),
                    Paragraph("Included sessions", styles["ReportHeading"]),
                ]
            )
            for session in included_sessions:
                session_name = str(cast(Dict[str, Any], session.get("exercise") or {}).get("name") or "Saved session")
                session_copy = f"{self._format_date(session.get('timestamp'))} — {session_name}. {self._format_session_metrics(session)}"
                story.append(Paragraph(self._pdf_text(session_copy), styles["ReportBullet"]))

        for section in sections:
            self._append_pdf_section_story(story, section, styles, document.width)

        story.extend(
            [
                Spacer(1, 16),
                Paragraph(
                    "This document summarizes therapist-reviewed Wulo practice data. It supports supervision, family communication, and school coordination, but it does not replace clinical judgment or diagnosis.",
                    styles["ReportFooter"],
                ),
            ]
        )
        if redaction_notice:
            story.append(Paragraph(self._pdf_text(redaction_notice), styles["ReportFooter"]))

        document.build(
            story,
            onFirstPage=self._draw_pdf_footer,
            onLaterPages=self._draw_pdf_footer,
        )
        return buffer.getvalue()

    def _build_pdf_styles(self) -> Dict[str, Any]:
        stylesheet = getSampleStyleSheet()
        return {
            "ReportEyebrow": ParagraphStyle(
                "ReportEyebrow",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
            "ReportTitle": ParagraphStyle(
                "ReportTitle",
                parent=stylesheet["Heading1"],
                fontName="Helvetica-Bold",
                fontSize=22,
                leading=26,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=4,
            ),
            "ReportSubtitle": ParagraphStyle(
                "ReportSubtitle",
                parent=stylesheet["BodyText"],
                fontSize=11,
                leading=15,
                textColor=colors.HexColor("#56717c"),
            ),
            "ReportBadges": ParagraphStyle(
                "ReportBadges",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=9,
                leading=12,
                textColor=colors.HexColor("#127a72"),
            ),
            "ReportSectionLabel": ParagraphStyle(
                "ReportSectionLabel",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
            "ReportHeading": ParagraphStyle(
                "ReportHeading",
                parent=stylesheet["Heading2"],
                fontName="Helvetica-Bold",
                fontSize=14,
                leading=18,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=6,
                spaceBefore=10,
            ),
            "ReportBody": ParagraphStyle(
                "ReportBody",
                parent=stylesheet["BodyText"],
                fontSize=10,
                leading=15,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=6,
            ),
            "ReportBullet": ParagraphStyle(
                "ReportBullet",
                parent=stylesheet["BodyText"],
                fontSize=10,
                leading=14,
                leftIndent=12,
                firstLineIndent=-10,
                spaceAfter=4,
                textColor=colors.HexColor("#16303c"),
            ),
            "ReportMetricLabel": ParagraphStyle(
                "ReportMetricLabel",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
            ),
            "ReportMetricValue": ParagraphStyle(
                "ReportMetricValue",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=10,
                leading=12,
                textColor=colors.HexColor("#16303c"),
            ),
            "ReportFooter": ParagraphStyle(
                "ReportFooter",
                parent=stylesheet["BodyText"],
                fontSize=8,
                leading=11,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
        }

    def _append_pdf_section_story(
        self,
        story: List[Any],
        section: Dict[str, Any],
        styles: Dict[str, Any],
        content_width: float,
    ) -> None:
        story.extend(
            [
                Spacer(1, 14),
                Paragraph(self._pdf_text(str(section.get("title") or "Section")), styles["ReportHeading"]),
            ]
        )
        narrative = str(section.get("narrative") or "").strip()
        if narrative:
            story.append(Paragraph(self._pdf_text(narrative), styles["ReportBody"]))

        metrics = cast(List[Dict[str, Any]], section.get("metrics") or [])
        if metrics:
            story.append(
                self._build_pdf_metric_table(
                    [(str(metric.get("label") or "Metric"), str(metric.get("value") or "—")) for metric in metrics],
                    styles,
                    content_width,
                )
            )

        bullets = cast(List[str], section.get("bullets") or [])
        for bullet in bullets:
            story.append(Paragraph(self._pdf_text(f"• {bullet}"), styles["ReportBullet"]))

    def _build_pdf_metric_table(
        self,
        metric_cards: Sequence[tuple[str, str]],
        styles: Dict[str, Any],
        content_width: float,
    ) -> Any:
        label_width = min(52 * mm, content_width * 0.4)
        value_width = max(content_width - label_width, 48 * mm)
        table = Table(
            [
                [
                    Paragraph(self._pdf_text(label), styles["ReportMetricLabel"]),
                    Paragraph(self._pdf_text(value), styles["ReportMetricValue"]),
                ]
                for label, value in metric_cards
            ],
            colWidths=[label_width, value_width],
            hAlign="LEFT",
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f7fbfc")),
                    ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d9e2e6")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d9e2e6")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )
        return table

    def _draw_pdf_footer(self, canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#56717c"))
        canvas.drawRightString(document.pagesize[0] - document.rightMargin, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    def _pdf_text(self, value: Any) -> str:
        return escape(str(value or "")).replace("\n", "<br />")

    def _render_section_html(self, section: Dict[str, Any]) -> str:
        metrics = cast(List[Dict[str, Any]], section.get("metrics") or [])
        bullets = cast(List[str], section.get("bullets") or [])
        metric_html = "".join(
            f"<div class=\"section-metric\"><span class=\"section-metric-label\">{escape(str(metric.get('label') or 'Metric'))}</span><span class=\"section-metric-value\">{escape(str(metric.get('value') or '—'))}</span></div>"
            for metric in metrics
        )
        bullet_html = "".join(f"<li>{escape(str(bullet))}</li>" for bullet in bullets)
        narrative = str(section.get("narrative") or "").strip()
        content_parts = [f"<section class=\"section\"><h3>{escape(str(section.get('title') or 'Section'))}</h3>"]
        if narrative:
            content_parts.append(f"<p>{escape(narrative)}</p>")
        if metric_html:
            content_parts.append(f"<div class=\"section-metrics\">{metric_html}</div>")
        if bullet_html:
            content_parts.append(f"<ul>{bullet_html}</ul>")
        content_parts.append("</section>")
        return "".join(content_parts)

    def _format_session_metrics(self, session: Dict[str, Any]) -> str:
        metric_parts: List[str] = []
        if session.get("overall_score") is not None:
            metric_parts.append(f"Overall {session.get('overall_score')}")
        if session.get("accuracy_score") is not None:
            metric_parts.append(f"Accuracy {session.get('accuracy_score')}")
        if session.get("pronunciation_score") is not None:
            metric_parts.append(f"Pronunciation {session.get('pronunciation_score')}")
        return " • ".join(metric_parts) or "Saved review available"

    def _build_title(self, child: Dict[str, Any], audience: str, period_end: str) -> str:
        child_name = str(child.get("name") or "Child").strip() or "Child"
        date_label = self._format_date(period_end)
        return f"{child_name} {audience.title()} Progress Report · {date_label}"

    def _build_snapshot(
        self,
        child_id: str,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        overall_scores = [score for score in [self._as_float(session.get("overall_score")) for session in included_sessions] if score is not None]
        accuracy_scores = [score for score in [self._as_float(session.get("accuracy_score")) for session in included_sessions] if score is not None]
        pronunciation_scores = [
            score for score in [self._as_float(session.get("pronunciation_score")) for session in included_sessions] if score is not None
        ]
        target_sounds = self._collect_target_sounds(included_sessions)
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
            "generated_at": self._utc_now(),
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

    def _build_sections(
        self,
        *,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        audience: str,
        snapshot: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        child_name = str(child.get("name") or "This child").strip() or "This child"
        session_bullets = [self._format_session_bullet(session) for session in included_sessions[:4]]
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
                "narrative": self._build_summary_text(child, included_sessions, audience),
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

    def _build_summary_text(
        self,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        audience: str,
    ) -> str:
        child_name = str(child.get("name") or "This child").strip() or "This child"
        overall_scores = [score for score in [self._as_float(session.get("overall_score")) for session in included_sessions] if score is not None]
        average_overall = round(mean(overall_scores), 1) if overall_scores else None
        focus_targets = self._collect_target_sounds(included_sessions)
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

    def _collect_target_sounds(self, sessions: Sequence[Dict[str, Any]]) -> List[str]:
        targets: List[str] = []
        for session in sessions:
            metadata = cast(Dict[str, Any], session.get("exercise_metadata") or {})
            target = str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip()
            if target and target not in targets:
                targets.append(target)
        return targets[:4]

    def _format_session_bullet(self, session: Dict[str, Any]) -> str:
        exercise = cast(Dict[str, Any], session.get("exercise") or {})
        exercise_name = str(exercise.get("name") or "Session").strip() or "Session"
        overall = session.get("overall_score")
        accuracy = session.get("accuracy_score")
        timestamp = self._format_date(session.get("timestamp"))
        metric_parts = []
        if overall is not None:
            metric_parts.append(f"overall {overall}")
        if accuracy is not None:
            metric_parts.append(f"accuracy {accuracy}")
        metrics = f" ({', '.join(metric_parts)})" if metric_parts else ""
        return f"{timestamp}: {exercise_name}{metrics}."

    def _as_float(self, value: Any) -> Optional[float]:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _parse_iso(self, value: Any) -> Optional[datetime]:
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

    def _format_date(self, value: Any) -> str:
        parsed = self._parse_iso(value)
        if parsed is None:
            return "Recent review"
        return parsed.strftime("%b %d, %Y")

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()
