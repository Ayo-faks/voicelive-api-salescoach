"""Tests for progress report generation and lifecycle."""

from pathlib import Path

import pytest

from src.services.report_exporters import REPORTLAB_AVAILABLE
from src.services.report_service import ProgressReportService
from src.services.storage import StorageService


class _SummaryPrefixAssistant:
    def rewrite_summary(self, *, summary_text: str, **_: object) -> str:
        return f"AI draft: {summary_text}"


def _seed_report_context(service: StorageService) -> None:
    service.get_or_create_user("therapist-1", "therapist@example.com", "Therapist", "aad")
    service.save_session(
        {
            "id": "session-report-2",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "timestamp": "2026-03-30T10:00:00+00:00",
            "exercise": {
                "id": "exercise-source-r-listening",
                "name": "R Listening Warmup",
                "description": "Listen for /r/ in minimal pairs",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "easy",
                    "type": "listening_minimal_pairs",
                },
            },
            "exercise_metadata": {
                "targetSound": "r",
                "difficulty": "easy",
                "type": "listening_minimal_pairs",
            },
            "ai_assessment": {
                "overall_score": 72,
                "engagement_and_effort": {"willingness_to_retry": 7},
            },
            "pronunciation_assessment": {
                "accuracy_score": 70,
                "pronunciation_score": 71,
            },
            "transcript": "Child listened for /r/ contrasts.",
            "reference_text": "red and wed",
        }
    )
    saved_session = service.save_session(
        {
            "id": "session-report-1",
            "child_id": "child-ayo",
            "child_name": "Ayo",
            "timestamp": "2026-04-06T10:00:00+00:00",
            "exercise": {
                "id": "exercise-source-r",
                "name": "R Warmup",
                "description": "Practice /r/ words",
                "exerciseMetadata": {
                    "targetSound": "r",
                    "difficulty": "medium",
                    "type": "two_word_phrase",
                },
            },
            "exercise_metadata": {
                "targetSound": "r",
                "difficulty": "medium",
                "type": "two_word_phrase",
            },
            "ai_assessment": {
                "overall_score": 84,
                "engagement_and_effort": {"willingness_to_retry": 8},
            },
            "pronunciation_assessment": {
                "accuracy_score": 82,
                "pronunciation_score": 81,
            },
            "transcript": "Child practised /r/ in words.",
            "reference_text": "red rabbit",
        }
    )
    service.save_practice_plan(
        {
            "id": "plan-report-1",
            "child_id": "child-ayo",
            "source_session_id": saved_session["id"],
            "status": "approved",
            "title": "Move /r/ into short phrases",
            "plan_type": "next_session",
            "constraints": {"therapist_message": "Keep it playful."},
            "draft": {
                "objective": "Move /r/ from words into short phrases.",
                "focus_sound": "r",
                "rationale": "Ayo is ready for phrase-level work.",
                "estimated_duration_minutes": 15,
                "activities": [],
                "therapist_cues": ["Short model once before the child repeats."],
                "success_criteria": ["Stable /r/ in phrase-level practice."],
                "carryover": ["Use one phrase at home after dinner."],
            },
            "conversation": [],
            "created_by_user_id": "therapist-1",
        }
    )
    service.save_recommendation_log(
        {
            "id": "recommendation-log-report-1",
            "child_id": "child-ayo",
            "source_session_id": saved_session["id"],
            "target_sound": "r",
            "therapist_constraints": {"note": "Keep this playful."},
            "ranking_context": {"current_target_sound": "r"},
            "rationale": "Phrase-level practice is the best next step.",
            "created_by_user_id": "therapist-1",
            "candidate_count": 1,
            "top_recommendation_score": 18,
        }
    )
    service.replace_recommendation_candidates(
        "recommendation-log-report-1",
        [
            {
                "id": "candidate-report-1",
                "rank": 1,
                "exercise_id": "exercise-phrase-r",
                "exercise_name": "R Phrase Builder",
                "exercise_description": "Move /r/ into short phrases.",
                "exercise_metadata": {"targetSound": "r", "difficulty": "hard"},
                "score": 18,
                "ranking_factors": {"progression": {"score": 6, "reason": "Ready for phrase work."}},
                "rationale": "Phrase-level practice is the best next step.",
                "explanation": {"why_recommended": "Phrase work fits the latest session."},
                "supporting_memory_item_ids": [],
                "supporting_session_ids": [saved_session["id"]],
            }
        ],
    )


def test_create_update_and_advance_progress_report(tmp_path: Path):
    storage = StorageService(str(tmp_path / "reports.db"))
    _seed_report_context(storage)
    service = ProgressReportService(storage)

    report = service.create_report(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        audience="parent",
        period_start="2026-04-01T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-1"],
    )

    assert report["status"] == "draft"
    assert report["audience"] == "parent"
    assert report["snapshot"]["session_count"] == 1
    assert report["included_session_ids"] == ["session-report-1"]
    assert any(section["key"] == "home-support" for section in report["sections"])

    updated = service.update_report(
        report["id"],
        audience="school",
        title="Ayo School Update",
        period_start="2026-03-30T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-2", "session-report-1"],
        redaction_overrides={
            "hide_summary_text": True,
            "hide_session_list": True,
            "hidden_section_keys": ["school-impact"],
        },
    )
    assert updated["title"] == "Ayo School Update"
    assert updated["audience"] == "school"
    assert updated["snapshot"]["session_count"] == 2
    assert any(section["key"] == "school-impact" for section in updated["sections"])
    assert updated["redaction_overrides"]["hide_summary_text"] is True

    html_document = service.render_report_html(report["id"])
    assert html_document.startswith("<!doctype html>")
    assert "Ayo School Update" in html_document
    assert "Print or save as PDF" in html_document
    assert "R Warmup" in html_document
    assert "Executive summary" not in html_document
    assert "Included sessions" not in html_document
    assert "School participation impact" not in html_document
    assert "Suggested classroom supports" in html_document

    if REPORTLAB_AVAILABLE:
        pdf_document = service.render_report_pdf(report["id"])
        assert pdf_document.startswith(b"%PDF")
    else:
        with pytest.raises(RuntimeError, match="PDF export is unavailable"):
            service.render_report_pdf(report["id"])

    approved = service.approve_report(report["id"])
    assert approved["status"] == "approved"

    signed = service.sign_report(report["id"], "therapist-1")
    assert signed["status"] == "signed"
    assert signed["signed_by_user_id"] == "therapist-1"

    archived = service.archive_report(report["id"])
    assert archived["status"] == "archived"


def test_optional_summary_assistant_only_rewrites_saved_summary(tmp_path: Path):
    storage = StorageService(str(tmp_path / "reports-ai.db"))
    _seed_report_context(storage)
    service = ProgressReportService(storage, summary_assistant=_SummaryPrefixAssistant())

    report = service.create_report(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        audience="parent",
        period_start="2026-04-01T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-1"],
    )

    overview_section = next(section for section in report["sections"] if section["key"] == "overview")

    assert not str(report["summary_text"]).startswith("AI draft: ")
    assert not str(overview_section["narrative"]).startswith("AI draft: ")

    suggestion = service.suggest_summary_rewrite(report["id"])

    assert suggestion["report_id"] == report["id"]
    assert suggestion["review_required"] is True
    assert suggestion["draft_only"] is True
    assert suggestion["source_summary_text"] == report["summary_text"]
    assert suggestion["suggested_summary_text"].startswith("AI draft: ")

    unchanged = service.get_report(report["id"])
    assert unchanged["summary_text"] == report["summary_text"]


def test_progress_report_source_defaults_and_ai_insight_roundtrip(tmp_path: Path):
    """Pipeline-generated reports default to source='pipeline' and AI-drafted reports persist source='ai_insight'."""
    storage = StorageService(str(tmp_path / "reports-source.db"))
    _seed_report_context(storage)
    service = ProgressReportService(storage)

    pipeline_report = service.create_report(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        audience="therapist",
        period_start="2026-04-01T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-1"],
    )
    assert pipeline_report["source"] == "pipeline"

    ai_report = service.create_report(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        audience="therapist",
        period_start="2026-04-01T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-1"],
        source="ai_insight",
    )
    assert ai_report["source"] == "ai_insight"

    # Unknown source values fall back to the safe default.
    manual_report = service.create_report(
        child_id="child-ayo",
        created_by_user_id="therapist-1",
        audience="therapist",
        period_start="2026-04-01T00:00:00+00:00",
        period_end="2026-04-07T23:59:59+00:00",
        included_session_ids=["session-report-1"],
        source="not-a-real-source",
    )
    assert manual_report["source"] == "pipeline"

    reloaded = storage.get_progress_report(ai_report["id"])
    assert reloaded is not None
    assert reloaded["source"] == "ai_insight"

    listed = storage.list_progress_reports_for_child("child-ayo")
    by_id = {row["id"]: row["source"] for row in listed}
    assert by_id[pipeline_report["id"]] == "pipeline"
    assert by_id[ai_report["id"]] == "ai_insight"
