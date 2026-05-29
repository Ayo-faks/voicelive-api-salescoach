"""Admin REST routes for the safeguarding event queue.

B2C scope: only ``admin`` role may list and acknowledge events.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Mapping, Optional, Tuple

from flask import Blueprint, jsonify, request

from .service import SafeguardingService


HTTP_OK = 200
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409
HTTP_SERVICE_UNAVAILABLE = 503


# Auth callable: () -> (user_dict_or_None, error_response_tuple_or_None)
AuthFn = Callable[[], Tuple[Optional[Mapping[str, Any]], Optional[Tuple[Any, int]]]]
# Service accessor: () -> SafeguardingService or None
ServiceFn = Callable[[], Optional[SafeguardingService]]


def build_safeguarding_blueprint(
    *,
    require_admin: AuthFn,
    get_service: ServiceFn,
) -> Blueprint:
    bp = Blueprint("safeguarding", __name__, url_prefix="/api/admin/safeguarding")

    @bp.route("/events", methods=["GET"])
    def list_events():  # noqa: ANN202
        user, guard = require_admin()
        if guard is not None:
            return guard
        service = get_service()
        if service is None:
            return jsonify({"error": "safeguarding_not_configured"}), HTTP_SERVICE_UNAVAILABLE

        status = (request.args.get("status") or "open").strip().lower()
        if status not in {"open", "acknowledged", "all"}:
            return jsonify({"error": "invalid_status"}), HTTP_BAD_REQUEST
        try:
            limit = max(1, min(int(request.args.get("limit") or 50), 200))
        except (TypeError, ValueError):
            return jsonify({"error": "invalid_limit"}), HTTP_BAD_REQUEST

        acknowledged: Optional[bool]
        if status == "open":
            acknowledged = False
        elif status == "acknowledged":
            acknowledged = True
        else:
            acknowledged = None

        events = service.list_recent(limit=limit, acknowledged=acknowledged)
        return jsonify({"events": [e.to_dict() for e in events]}), HTTP_OK

    @bp.route("/events/<event_id>", methods=["GET"])
    def get_event(event_id: str):  # noqa: ANN202
        user, guard = require_admin()
        if guard is not None:
            return guard
        service = get_service()
        if service is None:
            return jsonify({"error": "safeguarding_not_configured"}), HTTP_SERVICE_UNAVAILABLE
        # Use the repository directly via service.list_recent; we don't
        # expose a separate getter on the service. For now scan recents.
        for event in service.list_recent(limit=200, acknowledged=None):
            if event.id == event_id:
                return jsonify(event.to_dict()), HTTP_OK
        return jsonify({"error": "not_found"}), HTTP_NOT_FOUND

    @bp.route("/events/<event_id>/acknowledge", methods=["POST"])
    def acknowledge(event_id: str):  # noqa: ANN202
        user, guard = require_admin()
        if guard is not None:
            return guard
        service = get_service()
        if service is None:
            return jsonify({"error": "safeguarding_not_configured"}), HTTP_SERVICE_UNAVAILABLE

        payload: Dict[str, Any] = request.get_json(silent=True) or {}
        action_taken = str(payload.get("action_taken") or "").strip()
        action_notes = payload.get("action_notes")
        if not action_taken:
            return jsonify({"error": "action_taken_required"}), HTTP_BAD_REQUEST
        if action_notes is not None and not isinstance(action_notes, str):
            return jsonify({"error": "action_notes_must_be_string"}), HTTP_BAD_REQUEST

        acknowledged_by = str((user or {}).get("email") or (user or {}).get("user_id") or "admin")
        event = service.acknowledge(
            event_id,
            acknowledged_by=acknowledged_by,
            action_taken=action_taken,
            action_notes=action_notes,
        )
        if event is None:
            return jsonify({"error": "not_found"}), HTTP_NOT_FOUND
        if event.acknowledged_by != acknowledged_by:
            # Already acknowledged by someone else previously.
            return jsonify({"error": "already_acknowledged", "event": event.to_dict()}), HTTP_CONFLICT
        return jsonify({"event": event.to_dict()}), HTTP_OK

    return bp
