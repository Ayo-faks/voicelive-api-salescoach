"""Shared voice-agent contracts.

These types are the wire-level surface the Pathfinder voice agent uses to
ship structured UI and proposed actions alongside the spoken answer. They
mirror the TypeScript types in ``frontend/src/types/index.ts``.

Phase 1 scope: contract definitions and a defensive validator/sanitizer
suitable for use by the websocket handler before forwarding planner output
to the client. The planner does not emit these yet; Phase 2 wires the
Copilot adapter to produce them.

Design rules:
- UI specs are declarative and small. Never accept raw HTML/JSX.
- Action suggestions never execute on receipt. They are proposals only.
- All caps below are intentionally conservative for first release.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional

# --- Whitelists -------------------------------------------------------------

UI_SPEC_KINDS: frozenset[str] = frozenset(
    {
        "text",
        "table",
        "chart",
        "form",
        "confirmation",
        "studentProfile",
        "planDraft",
        "actionResult",
    }
)

ACTION_TYPES: frozenset[str] = frozenset(
    {
        "submit_learning_intent",
        "approve_learning_plan",
        "reject_learning_plan",
        "edit_approve_learning_plan",
        "create_intervention_plan_draft",
        "open_student_profile",
    }
)

RISK_LEVELS: frozenset[str] = frozenset({"low", "medium", "high"})

FORM_FIELD_KINDS: frozenset[str] = frozenset(
    {"text", "textarea", "number", "select", "boolean", "date"}
)

# --- Caps -------------------------------------------------------------------

MAX_UI_SPECS_PER_TURN = 4
MAX_ACTIONS_PER_TURN = 3
MAX_FORM_FIELDS = 12
MAX_STRING_LEN = 1200
MAX_LABEL_LEN = 160
MAX_PARAM_KEYS = 16


# --- Helpers ----------------------------------------------------------------


def _clip_str(value: Any, *, limit: int = MAX_STRING_LEN) -> str:
    text = "" if value is None else str(value)
    if len(text) > limit:
        return text[: limit - 1] + "\u2026"
    return text


def _sanitize_params(value: Any) -> Dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    out: Dict[str, Any] = {}
    for key, raw in list(value.items())[:MAX_PARAM_KEYS]:
        if not isinstance(key, str) or not key:
            continue
        if isinstance(raw, (str, int, float, bool)) or raw is None:
            out[key] = raw if not isinstance(raw, str) else _clip_str(raw)
        elif isinstance(raw, (list, tuple)):
            out[key] = [
                _clip_str(item) if isinstance(item, str) else item
                for item in list(raw)[:32]
                if isinstance(item, (str, int, float, bool))
            ]
        elif isinstance(raw, Mapping):
            out[key] = _sanitize_params(raw)
        # silently drop unsupported types
    return out


# --- UI specs ---------------------------------------------------------------


def _sanitize_form_spec(spec: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    fields_raw = spec.get("fields")
    if not isinstance(fields_raw, list):
        return None
    fields: List[Dict[str, Any]] = []
    for field in fields_raw[:MAX_FORM_FIELDS]:
        if not isinstance(field, Mapping):
            continue
        name = _clip_str(field.get("name"), limit=64)
        kind = str(field.get("kind") or "text")
        if not name or kind not in FORM_FIELD_KINDS:
            continue
        cleaned: Dict[str, Any] = {
            "name": name,
            "kind": kind,
            "label": _clip_str(field.get("label") or name, limit=MAX_LABEL_LEN),
            "required": bool(field.get("required")),
        }
        if "help" in field:
            cleaned["help"] = _clip_str(field.get("help"), limit=240)
        if "placeholder" in field:
            cleaned["placeholder"] = _clip_str(field.get("placeholder"), limit=120)
        if kind == "select":
            options = field.get("options")
            if isinstance(options, list):
                cleaned["options"] = [
                    {
                        "value": _clip_str(opt.get("value"), limit=64),
                        "label": _clip_str(opt.get("label") or opt.get("value"), limit=MAX_LABEL_LEN),
                    }
                    for opt in options[:32]
                    if isinstance(opt, Mapping) and opt.get("value") is not None
                ]
        if "default" in field:
            default = field.get("default")
            if isinstance(default, (str, int, float, bool)):
                cleaned["default"] = (
                    _clip_str(default) if isinstance(default, str) else default
                )
        fields.append(cleaned)
    if not fields:
        return None
    return {
        "title": _clip_str(spec.get("title"), limit=MAX_LABEL_LEN),
        "submit_label": _clip_str(spec.get("submit_label") or "Submit", limit=64),
        "fields": fields,
    }


def sanitize_ui_specs(specs: Optional[Iterable[Any]]) -> List[Dict[str, Any]]:
    """Drop unknown kinds, clip strings, cap counts.

    Returns ``[]`` for any malformed input. Safe to ship verbatim to the
    websocket client.
    """

    if not specs:
        return []
    out: List[Dict[str, Any]] = []
    for spec in list(specs)[:MAX_UI_SPECS_PER_TURN]:
        if not isinstance(spec, Mapping):
            continue
        kind = str(spec.get("kind") or "")
        if kind not in UI_SPEC_KINDS:
            continue
        cleaned: Dict[str, Any] = {
            "kind": kind,
            "id": _clip_str(spec.get("id"), limit=64) or None,
        }
        if "title" in spec:
            cleaned["title"] = _clip_str(spec.get("title"), limit=MAX_LABEL_LEN)
        if kind == "text":
            cleaned["body"] = _clip_str(spec.get("body"))
        elif kind == "form":
            form = _sanitize_form_spec(spec)
            if form is None:
                continue
            cleaned.update(form)
        elif kind == "confirmation":
            cleaned["prompt"] = _clip_str(spec.get("prompt") or spec.get("body"))
            cleaned["confirm_label"] = _clip_str(
                spec.get("confirm_label") or "Confirm", limit=64
            )
            cleaned["cancel_label"] = _clip_str(
                spec.get("cancel_label") or "Cancel", limit=64
            )
            if "action_id" in spec:
                cleaned["action_id"] = _clip_str(spec.get("action_id"), limit=64)
        elif kind in {"chart", "table"}:
            # Defer to the existing visualization validator. Pass through as-is;
            # the websocket handler should validate via VisualizationService.
            payload = spec.get("payload")
            if not isinstance(payload, Mapping):
                continue
            cleaned["payload"] = dict(payload)
        elif kind == "studentProfile":
            student_id = _clip_str(spec.get("student_id"), limit=64)
            if not student_id:
                continue
            cleaned["student_id"] = student_id
        elif kind == "planDraft":
            cleaned["plan_id"] = _clip_str(spec.get("plan_id"), limit=64) or None
            cleaned["summary"] = _clip_str(spec.get("summary"))
        elif kind == "actionResult":
            cleaned["action_id"] = _clip_str(spec.get("action_id"), limit=64)
            cleaned["status"] = _clip_str(spec.get("status"), limit=32)
            cleaned["message"] = _clip_str(spec.get("message"))
        out.append(cleaned)
    return out


# --- Action suggestions -----------------------------------------------------


def sanitize_action_suggestions(
    suggestions: Optional[Iterable[Any]],
) -> List[Dict[str, Any]]:
    """Drop unknown action types, clip strings, cap count.

    Action suggestions are *proposals only*; they never trigger execution.
    The action service (Phase 3) is the only place that can mutate state and
    must independently re-validate every field.
    """

    if not suggestions:
        return []
    out: List[Dict[str, Any]] = []
    for raw in list(suggestions)[:MAX_ACTIONS_PER_TURN]:
        if not isinstance(raw, Mapping):
            continue
        action_id = _clip_str(raw.get("action_id"), limit=64)
        action_type = str(raw.get("action_type") or "")
        if not action_id or action_type not in ACTION_TYPES:
            continue
        risk_level = str(raw.get("risk_level") or "medium")
        if risk_level not in RISK_LEVELS:
            risk_level = "medium"
        out.append(
            {
                "action_id": action_id,
                "action_type": action_type,
                "label": _clip_str(raw.get("label") or action_type, limit=MAX_LABEL_LEN),
                "risk_level": risk_level,
                "requires_confirmation": bool(
                    raw.get("requires_confirmation", True)
                ),
                "parameters": _sanitize_params(raw.get("parameters")),
                "rationale": _clip_str(raw.get("rationale"), limit=480),
            }
        )
    return out
