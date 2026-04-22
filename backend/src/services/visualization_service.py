"""Visualization contract for Insights answers.

This module defines a bounded, therapist-safe JSON schema that any LLM or
deterministic backend path can emit when it wants the frontend to render a
chart or table. The schema is intentionally small — only ``line``, ``bar``,
and ``table`` are accepted in v1 — and every field is size-capped so a
malformed spec cannot inflate the payload or the DOM.

Usage::

    from src.services.visualization_service import (
        VisualizationValidationError,
        validate_visualization,
    )

    spec = validate_visualization({"kind": "line", "title": "Trend", ...})

The returned dict is a fresh, sanitized copy safe to send to the frontend.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple, Union

VisualizationKind = str  # 'line' | 'bar' | 'table' — enforced at runtime

# Size caps — keep these in lockstep with the frontend renderer.
MAX_TITLE_LENGTH = 120
MAX_CAPTION_LENGTH = 280
MAX_AXIS_LABEL_LENGTH = 60
MAX_SERIES_NAME_LENGTH = 60
MAX_POINT_LABEL_LENGTH = 40
MAX_COLUMN_LABEL_LENGTH = 60
MAX_COLUMN_KEY_LENGTH = 60
MAX_CELL_STRING_LENGTH = 200

MAX_SERIES_PER_CHART = 8
MAX_POINTS_PER_SERIES = 200
MAX_TABLE_COLUMNS = 24
MAX_TABLE_ROWS = 200

ALLOWED_KINDS = ("line", "bar", "table")


class VisualizationValidationError(ValueError):
    """Raised when a visualization spec does not match the contract."""


ScalarCell = Union[str, int, float, bool, None]


def validate_visualization(spec: Any) -> Dict[str, Any]:
    """Validate and sanitize a visualization spec.

    Returns a new dict containing only whitelisted, length-capped fields.
    Raises :class:`VisualizationValidationError` on any violation.
    """
    if not isinstance(spec, dict):
        raise VisualizationValidationError("spec must be an object")

    kind = spec.get("kind")
    if kind not in ALLOWED_KINDS:
        raise VisualizationValidationError(
            f"kind must be one of {ALLOWED_KINDS}, got {kind!r}"
        )

    title = _require_str(spec.get("title"), "title", MAX_TITLE_LENGTH)
    caption = _optional_str(spec.get("caption"), "caption", MAX_CAPTION_LENGTH)

    out: Dict[str, Any] = {"kind": kind, "title": title}
    if caption is not None:
        out["caption"] = caption

    if kind in ("line", "bar"):
        out.update(_validate_chart(spec))
    else:  # table
        out.update(_validate_table(spec))

    return out


def _validate_chart(spec: Dict[str, Any]) -> Dict[str, Any]:
    x_label = _optional_str(spec.get("x_label"), "x_label", MAX_AXIS_LABEL_LENGTH) or ""
    y_label = _optional_str(spec.get("y_label"), "y_label", MAX_AXIS_LABEL_LENGTH) or ""

    raw_series = spec.get("series")
    if not isinstance(raw_series, list) or not raw_series:
        raise VisualizationValidationError("series must be a non-empty list")
    if len(raw_series) > MAX_SERIES_PER_CHART:
        raise VisualizationValidationError(
            f"series may contain at most {MAX_SERIES_PER_CHART} entries"
        )

    series_out: List[Dict[str, Any]] = []
    for index, series in enumerate(raw_series):
        if not isinstance(series, dict):
            raise VisualizationValidationError(f"series[{index}] must be an object")
        name = _require_str(series.get("name"), f"series[{index}].name", MAX_SERIES_NAME_LENGTH)
        raw_points = series.get("points")
        if not isinstance(raw_points, list) or not raw_points:
            raise VisualizationValidationError(
                f"series[{index}].points must be a non-empty list"
            )
        if len(raw_points) > MAX_POINTS_PER_SERIES:
            raise VisualizationValidationError(
                f"series[{index}].points may contain at most {MAX_POINTS_PER_SERIES} entries"
            )
        points_out: List[Dict[str, Union[str, float]]] = []
        for point_index, point in enumerate(raw_points):
            if not isinstance(point, dict):
                raise VisualizationValidationError(
                    f"series[{index}].points[{point_index}] must be an object"
                )
            x_value = _coerce_axis_value(point.get("x"), f"series[{index}].points[{point_index}].x")
            y_value = _coerce_number(point.get("y"), f"series[{index}].points[{point_index}].y")
            points_out.append({"x": x_value, "y": y_value})
        series_out.append({"name": name, "points": points_out})

    return {
        "x_label": x_label,
        "y_label": y_label,
        "series": series_out,
    }


def _validate_table(spec: Dict[str, Any]) -> Dict[str, Any]:
    raw_columns = spec.get("columns")
    if not isinstance(raw_columns, list) or not raw_columns:
        raise VisualizationValidationError("columns must be a non-empty list")
    if len(raw_columns) > MAX_TABLE_COLUMNS:
        raise VisualizationValidationError(
            f"columns may contain at most {MAX_TABLE_COLUMNS} entries"
        )

    columns_out: List[Dict[str, str]] = []
    keys_seen: set[str] = set()
    for index, column in enumerate(raw_columns):
        if not isinstance(column, dict):
            raise VisualizationValidationError(f"columns[{index}] must be an object")
        key = _require_str(column.get("key"), f"columns[{index}].key", MAX_COLUMN_KEY_LENGTH)
        if key in keys_seen:
            raise VisualizationValidationError(f"columns[{index}].key {key!r} is not unique")
        keys_seen.add(key)
        label = _require_str(column.get("label"), f"columns[{index}].label", MAX_COLUMN_LABEL_LENGTH)
        columns_out.append({"key": key, "label": label})

    raw_rows = spec.get("rows")
    if not isinstance(raw_rows, list):
        raise VisualizationValidationError("rows must be a list")
    if len(raw_rows) > MAX_TABLE_ROWS:
        raise VisualizationValidationError(
            f"rows may contain at most {MAX_TABLE_ROWS} entries"
        )

    rows_out: List[Dict[str, ScalarCell]] = []
    allowed_keys = {column["key"] for column in columns_out}
    for index, row in enumerate(raw_rows):
        if not isinstance(row, dict):
            raise VisualizationValidationError(f"rows[{index}] must be an object")
        sanitized_row: Dict[str, ScalarCell] = {}
        for key in allowed_keys:
            sanitized_row[key] = _sanitize_cell(row.get(key))
        rows_out.append(sanitized_row)

    return {"columns": columns_out, "rows": rows_out}


def _require_str(value: Any, field: str, max_length: int) -> str:
    if not isinstance(value, str):
        raise VisualizationValidationError(f"{field} must be a string")
    cleaned = value.strip()
    if not cleaned:
        raise VisualizationValidationError(f"{field} must not be empty")
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
    return cleaned


def _optional_str(value: Any, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise VisualizationValidationError(f"{field} must be a string when provided")
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
    return cleaned


def _coerce_axis_value(value: Any, field: str) -> Union[str, float]:
    if isinstance(value, bool):
        raise VisualizationValidationError(f"{field} must be a string or number")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            raise VisualizationValidationError(f"{field} must not be empty")
        if len(cleaned) > MAX_POINT_LABEL_LENGTH:
            cleaned = cleaned[:MAX_POINT_LABEL_LENGTH]
        return cleaned
    raise VisualizationValidationError(f"{field} must be a string or number")


def _coerce_number(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise VisualizationValidationError(f"{field} must be a number")
    if isinstance(value, (int, float)):
        coerced = float(value)
        if coerced != coerced or coerced in (float("inf"), float("-inf")):  # NaN/inf check
            raise VisualizationValidationError(f"{field} must be a finite number")
        return coerced
    raise VisualizationValidationError(f"{field} must be a number")


def _sanitize_cell(value: Any) -> ScalarCell:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        coerced = float(value)
        if coerced != coerced or coerced in (float("inf"), float("-inf")):
            return None
        # Preserve ints as ints for nicer serialization.
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        return coerced
    if isinstance(value, str):
        cleaned = value.strip()
        if len(cleaned) > MAX_CELL_STRING_LENGTH:
            cleaned = cleaned[:MAX_CELL_STRING_LENGTH]
        return cleaned
    # Anything else (dict, list, etc.) collapses to None so the UI renders a blank cell.
    return None


__all__: Tuple[str, ...] = (
    "ALLOWED_KINDS",
    "MAX_CAPTION_LENGTH",
    "MAX_CELL_STRING_LENGTH",
    "MAX_COLUMN_LABEL_LENGTH",
    "MAX_POINTS_PER_SERIES",
    "MAX_SERIES_PER_CHART",
    "MAX_TABLE_COLUMNS",
    "MAX_TABLE_ROWS",
    "MAX_TITLE_LENGTH",
    "VisualizationValidationError",
    "validate_visualization",
)
