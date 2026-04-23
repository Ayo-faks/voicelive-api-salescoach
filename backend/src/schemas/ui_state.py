"""Validator for the ``/api/me/ui-state`` and ``/api/children/<id>/ui-state`` payloads.

The blob is deliberately small: only ephemeral UI flags go here. Anything with
auditability or PII implications lives in ``ui_state_audit`` or
``child_ui_state`` instead. See ``docs/onboarding/onboarding-plan-v2.md``
§"Tier A — Foundation".

Design notes:

- We don't pull in ``jsonschema`` as a dependency; this validator is a
  hand-rolled allow-list so we can return precise field-level errors and keep
  the wire format tight.
- Callers receive ``(normalized_patch, errors)``: when ``errors`` is empty the
  patch is ready to merge into ``users.ui_state``. On any error the patch is
  rejected wholesale — we never partial-apply.
- The full resulting ``users.ui_state`` blob is capped at
  ``MAX_UI_STATE_BYTES`` (8 KB serialized). This is checked at merge time by
  the storage layer, not here, because we only see the incoming patch.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple


# ---------------------------------------------------------------------------
# Allowed schema
# ---------------------------------------------------------------------------

#: Maximum serialized size of the merged ``users.ui_state`` blob, in bytes.
MAX_UI_STATE_BYTES: int = 8 * 1024

#: Maximum length of any individual string value (e.g. a tour id).
MAX_STRING_LENGTH: int = 128

#: Maximum number of entries in ``tours_seen`` / ``announcements_dismissed``.
MAX_ARRAY_LENGTH: int = 64

#: Maximum number of keys in the ``checklist_state`` map.
MAX_CHECKLIST_KEYS: int = 32

_ALLOWED_HELP_MODES: frozenset[str] = frozenset({"auto", "off"})


def _is_short_string(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value) <= MAX_STRING_LENGTH


def _validate_string_array(
    value: Any, *, field: str, errors: List[str]
) -> List[str] | None:
    if not isinstance(value, list):
        errors.append(f"{field} must be an array of strings")
        return None
    if len(value) > MAX_ARRAY_LENGTH:
        errors.append(f"{field} exceeds max length {MAX_ARRAY_LENGTH}")
        return None
    deduped: List[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not _is_short_string(item):
            errors.append(f"{field}[{index}] must be a non-empty string <= {MAX_STRING_LENGTH} chars")
            return None
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _validate_checklist_state(value: Any, *, errors: List[str]) -> Dict[str, bool] | None:
    if not isinstance(value, dict):
        errors.append("checklist_state must be an object of string -> bool")
        return None
    if len(value) > MAX_CHECKLIST_KEYS:
        errors.append(f"checklist_state exceeds max keys {MAX_CHECKLIST_KEYS}")
        return None
    normalized: Dict[str, bool] = {}
    for key, item in value.items():
        if not _is_short_string(key):
            errors.append("checklist_state keys must be non-empty strings")
            return None
        if not isinstance(item, bool):
            errors.append(f"checklist_state[{key!r}] must be a boolean")
            return None
        normalized[key] = item
    return normalized


def validate_ui_state_patch(
    patch: Any,
) -> Tuple[Dict[str, Any], List[str]]:
    """Validate a PATCH body for ``/api/me/ui-state``.

    Returns ``(normalized_patch, errors)``. A non-empty ``errors`` list means
    the caller should return HTTP 422 and not attempt the merge.
    """
    errors: List[str] = []
    if not isinstance(patch, dict):
        return {}, ["request body must be a JSON object"]

    normalized: Dict[str, Any] = {}
    for raw_key, value in patch.items():
        key = str(raw_key)
        if key == "tours_seen":
            cleaned = _validate_string_array(value, field="tours_seen", errors=errors)
            if cleaned is not None:
                normalized[key] = cleaned
        elif key == "announcements_dismissed":
            cleaned = _validate_string_array(value, field="announcements_dismissed", errors=errors)
            if cleaned is not None:
                normalized[key] = cleaned
        elif key == "checklist_state":
            cleaned_map = _validate_checklist_state(value, errors=errors)
            if cleaned_map is not None:
                normalized[key] = cleaned_map
        elif key == "help_mode":
            if not isinstance(value, str) or value not in _ALLOWED_HELP_MODES:
                errors.append(f"help_mode must be one of {sorted(_ALLOWED_HELP_MODES)}")
            else:
                normalized[key] = value
        elif key == "onboarding_complete":
            if not isinstance(value, bool):
                errors.append("onboarding_complete must be a boolean")
            else:
                normalized[key] = value
        else:
            errors.append(f"unknown field {key!r}")
    return normalized, errors


def validate_merged_size(merged: Dict[str, Any]) -> List[str]:
    """Guard against blob bloat after merge."""
    try:
        size = len(json.dumps(merged, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        return ["merged ui_state is not JSON-serializable"]
    if size > MAX_UI_STATE_BYTES:
        return [f"merged ui_state exceeds {MAX_UI_STATE_BYTES} bytes"]
    return []


# ---------------------------------------------------------------------------
# Child UI state
# ---------------------------------------------------------------------------

MAX_EXERCISE_TYPE_LENGTH: int = 64


def validate_child_ui_state_put(payload: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Validate a PUT body for ``/api/children/<id>/ui-state``.

    Accepted shape: ``{"exercise_type": str, "first_run": bool}``. ``first_run``
    is a boolean flag: ``True`` means "record first run now", ``False`` means
    "clear the first-run marker".
    """
    errors: List[str] = []
    if not isinstance(payload, dict):
        return {}, ["request body must be a JSON object"]

    exercise_type = payload.get("exercise_type")
    if not isinstance(exercise_type, str) or not exercise_type.strip():
        errors.append("exercise_type is required and must be a non-empty string")
        exercise_type = ""
    elif len(exercise_type) > MAX_EXERCISE_TYPE_LENGTH:
        errors.append(f"exercise_type exceeds max length {MAX_EXERCISE_TYPE_LENGTH}")

    first_run = payload.get("first_run")
    if not isinstance(first_run, bool):
        errors.append("first_run must be a boolean")

    if errors:
        return {}, errors

    return {"exercise_type": exercise_type.strip(), "first_run": bool(first_run)}, []
