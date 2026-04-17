"""Therapist-facing child progress reports built from saved review artifacts."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, cast
from uuid import uuid4

from .report_exporters import HtmlReportExporter, PdfReportExporter, ReportExportContextBuilder
from .report_pipeline import (
    DEFAULT_REPORT_TYPE,
    ReportSummaryAssistant,
    ReportArtifacts,
    ReportCompilationPipeline,
    ReportSummaryBuilder,
    SectionBuilder,
    SessionSelectionResolver,
    SnapshotBuilder,
    normalize_audience,
    normalize_session_ids,
    normalize_status,
)
from .report_redaction import ReportRedactionPolicy


class ProgressReportService:
    def __init__(
        self,
        storage_service: Any,
        summary_assistant: Optional[ReportSummaryAssistant] = None,
    ):
        self.storage_service = storage_service
        self.session_resolver = SessionSelectionResolver()
        self.summary_builder = ReportSummaryBuilder(summary_assistant=summary_assistant)
        self.snapshot_builder = SnapshotBuilder(storage_service)
        self.section_builder = SectionBuilder()
        self.compilation_pipeline = ReportCompilationPipeline(
            storage_service=storage_service,
            session_resolver=self.session_resolver,
            summary_builder=self.summary_builder,
            snapshot_builder=self.snapshot_builder,
            section_builder=self.section_builder,
        )
        self.redaction_policy = ReportRedactionPolicy()
        self.export_context_builder = ReportExportContextBuilder(
            storage_service=storage_service,
            session_resolver=self.session_resolver,
            redaction_policy=self.redaction_policy,
        )
        self.html_exporter = HtmlReportExporter()
        self.pdf_exporter = PdfReportExporter()

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
        return self.html_exporter.render(self._build_export_context(report_id))

    def render_report_pdf(self, report_id: str) -> bytes:
        return self.pdf_exporter.render(self._build_export_context(report_id))

    def suggest_summary_rewrite(self, report_id: str) -> Dict[str, Any]:
        report = self.get_report(report_id)
        if str(report.get("status") or "draft") != "draft":
            raise ValueError("Only draft reports can be rewritten")

        child_id = str(report.get("child_id") or "")
        child = self.storage_service.get_child(child_id)
        if child is None:
            raise ValueError("Child not found")

        included_session_ids = self._normalize_session_ids(report.get("included_session_ids"))
        included_sessions = self._resolve_included_sessions(
            self.storage_service.list_sessions_for_child(child_id),
            included_session_ids=included_session_ids,
            period_start=str(report.get("period_start") or "") or None,
            period_end=str(report.get("period_end") or "") or None,
            selection_provided=bool(included_session_ids),
        )
        if not included_sessions:
            raise ValueError("No saved sessions matched the selected report window")

        audience = self._normalize_audience(report.get("audience"))
        snapshot = cast(Dict[str, Any], report.get("snapshot") or {})
        source_summary_text = str(report.get("summary_text") or "").strip() or self._build_summary_text(
            child,
            included_sessions,
            audience,
        )
        suggested_summary_text = self.summary_builder.rewrite_summary_text(
            summary_text=source_summary_text,
            audience=audience,
            child=child,
            included_sessions=included_sessions,
            snapshot=snapshot,
        )

        return {
            "report_id": report_id,
            "source_summary_text": source_summary_text,
            "suggested_summary_text": suggested_summary_text,
            "review_required": True,
            "draft_only": True,
        }

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
        child = artifacts.child
        normalized_audience = artifacts.audience
        resolved_period_start = artifacts.period_start
        resolved_period_end = artifacts.period_end
        generated_summary = artifacts.summary_text
        snapshot = artifacts.snapshot
        sections = artifacts.sections
        included_sessions = artifacts.included_sessions

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

            generated_title = self._build_title(child, normalized_audience, artifacts.period_end)
            generated_summary = artifacts.summary_text
            if title is None and str(report.get("title") or "") == previous_generated_title:
                title_value = generated_title
            if summary_text is None and previous_generated_summary is not None and str(report.get("summary_text") or "") == previous_generated_summary:
                summary_value = generated_summary
            snapshot_value = artifacts.snapshot
            sections_value = artifacts.sections if sections is None else sections
            period_start_value = artifacts.period_start
            period_end_value = artifacts.period_end
            included_session_ids_value = [
                str(session.get("id") or "")
                for session in artifacts.included_sessions
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
        return normalize_audience(audience)

    def _normalize_status(self, status: Optional[str]) -> Optional[str]:
        return normalize_status(status)

    def _normalize_session_ids(self, included_session_ids: Any) -> List[str]:
        return normalize_session_ids(included_session_ids)

    def _build_report_artifacts(
        self,
        *,
        child_id: str,
        audience: str,
        period_start: Optional[str],
        period_end: Optional[str],
        included_session_ids: Optional[Sequence[str]],
    ) -> ReportArtifacts:
        return self.compilation_pipeline.build_report_artifacts(
            child_id=child_id,
            audience=audience,
            period_start=period_start,
            period_end=period_end,
            included_session_ids=included_session_ids,
        )

    def _resolve_included_sessions(
        self,
        session_summaries: Sequence[Dict[str, Any]],
        *,
        included_session_ids: Optional[Sequence[str]],
        period_start: Optional[str],
        period_end: Optional[str],
        selection_provided: bool = False,
    ) -> List[Dict[str, Any]]:
        return self.session_resolver.resolve_included_sessions(
            session_summaries,
            included_session_ids=included_session_ids,
            period_start=period_start,
            period_end=period_end,
            selection_provided=selection_provided,
        )

    def _build_export_context(self, report_id: str):
        report = self.get_report(report_id)
        return self.export_context_builder.build(report)

    def _build_title(self, child: Dict[str, Any], audience: str, period_end: str) -> str:
        return self.summary_builder.build_title(child, audience, period_end)

    def _build_summary_text(
        self,
        child: Dict[str, Any],
        included_sessions: Sequence[Dict[str, Any]],
        audience: str,
    ) -> str:
        return self.summary_builder.build_summary_text(child, included_sessions, audience)
