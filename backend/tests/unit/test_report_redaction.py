"""Tests for report export redaction rules."""

from src.services.report_redaction import ReportRedactionPolicy


def test_redaction_policy_normalizes_and_filters_export_sections() -> None:
    policy = ReportRedactionPolicy()
    overrides = policy.normalize_overrides(
        {
            "hide_summary_text": 1,
            "hide_overview_metrics": True,
            "hidden_section_keys": ["session-highlights", "", " next-steps "],
        }
    )
    sections = [
        {
            "key": "overview",
            "title": "Overview",
            "metrics": [{"label": "Reviewed sessions", "value": "2"}],
        },
        {
            "key": "session-highlights",
            "title": "Session highlights",
            "bullets": ["One", "Two"],
        },
        {
            "key": "clinical-focus",
            "title": "Clinical focus",
            "metrics": [{"label": "Focus", "value": "r"}],
        },
    ]

    filtered_sections = policy.filter_sections_for_export(sections, overrides)

    assert [section["key"] for section in filtered_sections] == ["overview", "clinical-focus"]
    assert filtered_sections[0]["metrics"] == []
    assert filtered_sections[1]["metrics"] == []


def test_redaction_policy_builds_human_readable_notice() -> None:
    policy = ReportRedactionPolicy()
    overrides = policy.normalize_overrides(
        {
            "hide_summary_text": True,
            "hide_session_list": True,
            "hide_internal_metadata": True,
            "hidden_section_keys": ["school-impact", "home-support"],
        }
    )

    notice = policy.build_redaction_notice(overrides)

    assert notice == (
        "This shared export hides the executive summary, the included-session list, "
        "internal workflow metadata, and 2 hidden section(s)."
    )