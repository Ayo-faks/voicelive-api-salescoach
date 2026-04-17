"""Redaction and visibility policy for progress report exports."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, cast

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


class ReportRedactionPolicy:
    def normalize_overrides(self, overrides: Any) -> Dict[str, Any]:
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

    def filter_sections_for_export(
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

    def build_redaction_notice(self, redaction_overrides: Dict[str, Any]) -> Optional[str]:
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