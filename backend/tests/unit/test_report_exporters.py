"""Tests for HTML and PDF report exporters."""

from __future__ import annotations

import pytest

from src.services.report_exporters import ExportContext, HtmlReportExporter, PdfReportExporter, REPORTLAB_AVAILABLE


def _build_export_context(**overrides: object) -> ExportContext:
    values = {
        "report": {"id": "report-1", "title": "Ayo school update"},
        "child_name": "Ayo",
        "subtitle": "Ayo • progress summary",
        "summary_text": "Ayo completed two reviewed sessions this week.",
        "metric_cards": [("Audience", "School"), ("Reviewed sessions", "2")],
        "included_sessions": [
            {
                "timestamp": "2026-04-06T10:00:00+00:00",
                "exercise": {"name": "R Warmup"},
                "overall_score": 84,
                "accuracy_score": 82,
                "pronunciation_score": 81,
            }
        ],
        "sections": [
            {
                "key": "classroom-support",
                "title": "Suggested classroom supports",
                "narrative": "Use short structured response windows.",
                "bullets": ["Pause before repeating.", "Keep prompts short."],
            }
        ],
        "badges": ["School audience", "Signed"],
        "show_summary_text": True,
        "show_overview_metrics": True,
        "show_session_list": True,
        "redaction_notice": None,
    }
    values.update(overrides)
    return ExportContext(**values)


def test_html_exporter_respects_redacted_visibility() -> None:
    exporter = HtmlReportExporter()
    export_context = _build_export_context(
        show_summary_text=False,
        show_overview_metrics=False,
        show_session_list=False,
        redaction_notice="This shared export hides the executive summary.",
    )

    document = exporter.render(export_context)

    assert document.startswith("<!doctype html>")
    assert "Ayo school update" in document
    assert "Executive summary" not in document
    assert "Included sessions" not in document
    assert "Audience" not in document
    assert "Suggested classroom supports" in document
    assert "This shared export hides the executive summary." in document


def test_pdf_exporter_returns_pdf_bytes() -> None:
    if not REPORTLAB_AVAILABLE:
        pytest.skip("reportlab is not installed")

    exporter = PdfReportExporter()
    document = exporter.render(_build_export_context())

    assert document.startswith(b"%PDF")