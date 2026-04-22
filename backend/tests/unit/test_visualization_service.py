"""Unit tests for the visualization contract validator."""

from __future__ import annotations

import pytest

from src.services.visualization_service import (
    MAX_POINTS_PER_SERIES,
    MAX_SERIES_PER_CHART,
    MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS,
    VisualizationValidationError,
    validate_visualization,
)


def _line_spec() -> dict:
    return {
        "kind": "line",
        "title": "Weekly overall score",
        "caption": "Latest 4 sessions",
        "x_label": "Session date",
        "y_label": "Score",
        "series": [
            {
                "name": "Overall",
                "points": [
                    {"x": "2026-03-01", "y": 62},
                    {"x": "2026-03-08", "y": 74},
                    {"x": "2026-03-15", "y": 81.5},
                ],
            }
        ],
    }


def _bar_spec() -> dict:
    return {
        "kind": "bar",
        "title": "Focus sound accuracy",
        "series": [
            {
                "name": "Accuracy",
                "points": [
                    {"x": "k", "y": 58},
                    {"x": "t", "y": 72},
                ],
            }
        ],
    }


def _table_spec() -> dict:
    return {
        "kind": "table",
        "title": "Recent sessions",
        "columns": [
            {"key": "date", "label": "Date"},
            {"key": "overall", "label": "Overall"},
            {"key": "note", "label": "Note"},
        ],
        "rows": [
            {"date": "2026-03-15", "overall": 81, "note": "Carryover gains"},
            {"date": "2026-03-08", "overall": 74, "note": None},
        ],
    }


class TestLineAndBarCharts:
    def test_line_spec_roundtrips(self):
        spec = validate_visualization(_line_spec())
        assert spec["kind"] == "line"
        assert spec["title"] == "Weekly overall score"
        assert spec["caption"] == "Latest 4 sessions"
        assert spec["x_label"] == "Session date"
        assert spec["series"][0]["points"][0] == {"x": "2026-03-01", "y": 62.0}

    def test_bar_spec_roundtrips_without_optional_fields(self):
        spec = validate_visualization(_bar_spec())
        assert spec["kind"] == "bar"
        assert spec["x_label"] == ""
        assert spec["y_label"] == ""
        assert "caption" not in spec
        assert spec["series"][0]["points"][1] == {"x": "t", "y": 72.0}

    def test_numeric_x_values_are_preserved_as_floats(self):
        base = _line_spec()
        base["series"][0]["points"] = [{"x": 1, "y": 10}, {"x": 2, "y": 20}]
        spec = validate_visualization(base)
        assert spec["series"][0]["points"] == [
            {"x": 1.0, "y": 10.0},
            {"x": 2.0, "y": 20.0},
        ]

    def test_nan_and_infinity_y_values_are_rejected(self):
        base = _line_spec()
        base["series"][0]["points"][0]["y"] = float("nan")
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_boolean_y_values_are_rejected(self):
        base = _line_spec()
        base["series"][0]["points"][0]["y"] = True
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_series_count_is_capped(self):
        base = _line_spec()
        base["series"] = [
            {"name": f"s{i}", "points": [{"x": i, "y": i}]}
            for i in range(MAX_SERIES_PER_CHART + 1)
        ]
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_point_count_is_capped(self):
        base = _line_spec()
        base["series"][0]["points"] = [
            {"x": i, "y": i} for i in range(MAX_POINTS_PER_SERIES + 1)
        ]
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_empty_series_rejected(self):
        base = _line_spec()
        base["series"] = []
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)


class TestTable:
    def test_table_spec_roundtrips(self):
        spec = validate_visualization(_table_spec())
        assert spec["kind"] == "table"
        assert [c["key"] for c in spec["columns"]] == ["date", "overall", "note"]
        assert spec["rows"][0] == {"date": "2026-03-15", "overall": 81, "note": "Carryover gains"}
        assert spec["rows"][1]["note"] is None

    def test_row_extra_keys_are_dropped(self):
        base = _table_spec()
        base["rows"].append({"date": "2026-03-01", "overall": 62, "note": "", "secret": "leak"})
        spec = validate_visualization(base)
        assert "secret" not in spec["rows"][2]

    def test_missing_row_keys_become_none(self):
        base = _table_spec()
        base["rows"].append({"date": "2026-02-22"})
        spec = validate_visualization(base)
        assert spec["rows"][2] == {"date": "2026-02-22", "overall": None, "note": None}

    def test_duplicate_column_keys_rejected(self):
        base = _table_spec()
        base["columns"].append({"key": "date", "label": "Also date"})
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_column_count_capped(self):
        base = _table_spec()
        base["columns"] = [
            {"key": f"c{i}", "label": f"Col {i}"} for i in range(MAX_TABLE_COLUMNS + 1)
        ]
        base["rows"] = []
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_row_count_capped(self):
        base = _table_spec()
        base["rows"] = [
            {"date": str(i), "overall": i, "note": None}
            for i in range(MAX_TABLE_ROWS + 1)
        ]
        with pytest.raises(VisualizationValidationError):
            validate_visualization(base)

    def test_long_strings_are_truncated(self):
        base = _table_spec()
        base["rows"][0]["note"] = "x" * 10_000
        spec = validate_visualization(base)
        assert isinstance(spec["rows"][0]["note"], str)
        assert len(spec["rows"][0]["note"]) <= 200

    def test_nested_cell_values_collapse_to_none(self):
        base = _table_spec()
        base["rows"][0]["note"] = {"injected": "payload"}
        spec = validate_visualization(base)
        assert spec["rows"][0]["note"] is None


class TestCommonValidation:
    def test_rejects_unknown_kind(self):
        with pytest.raises(VisualizationValidationError):
            validate_visualization({"kind": "scatter", "title": "nope"})

    def test_rejects_non_dict(self):
        with pytest.raises(VisualizationValidationError):
            validate_visualization("not a spec")  # type: ignore[arg-type]

    def test_missing_title_rejected(self):
        with pytest.raises(VisualizationValidationError):
            validate_visualization({"kind": "line", "series": []})

    def test_blank_title_rejected(self):
        with pytest.raises(VisualizationValidationError):
            validate_visualization({"kind": "line", "title": "   ", "series": []})

    def test_output_is_a_fresh_copy(self):
        source = _line_spec()
        spec = validate_visualization(source)
        spec["series"][0]["points"][0]["y"] = 9999
        assert source["series"][0]["points"][0]["y"] == 62
