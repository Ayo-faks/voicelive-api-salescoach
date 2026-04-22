"""Staff-only Flask blueprint for the listening-eval A/B tool.

Routes (all require therapist or admin role):

* ``POST   /staff/listening-eval/items``          — create a new A/B item
* ``GET    /staff/listening-eval/items``          — list active items
* ``GET    /staff/listening-eval/items/<id>``     — fetch an item (for the
                                                    play-side UI)
* ``DELETE /staff/listening-eval/items/<id>``     — retire an item
* ``POST   /staff/listening-eval/items/<id>/vote`` — cast a vote
* ``POST   /staff/listening-eval/rewards/refresh`` — recompute rewards
* ``GET    /staff/listening-eval/rewards``        — list cached rewards
* ``GET    /staff/listening-eval/export.csv``     — download vote CSV

The blueprint does not render HTML; it's consumed by the staff React
surface at ``frontend/src/app/staff/listening-eval``. Every endpoint
returns JSON except the CSV export.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Tuple

from flask import Blueprint, Response, jsonify, request

from src.services.listening_eval_service import (
    ListeningEvalItem,
    ListeningEvalService,
    build_dpo_preference_pairs,
)

__all__ = ["create_listening_eval_blueprint"]


RoleGuard = Callable[[], Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]]


def create_listening_eval_blueprint(
    service: ListeningEvalService,
    *,
    require_staff_user: RoleGuard,
    url_prefix: str = "/staff/listening-eval",
) -> Blueprint:
    bp = Blueprint("listening_eval", __name__, url_prefix=url_prefix)

    def _guard() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
        return require_staff_user()

    @bp.post("/items")
    def create_item():
        user, guard = _guard()
        if guard is not None:
            return guard
        payload = request.get_json(silent=True) or {}
        try:
            item = ListeningEvalItem(
                id="",
                target_token=str(payload["targetToken"]).strip(),
                target_sound=str(payload["targetSound"]).strip().lower(),
                reference_text=str(payload["referenceText"]).strip(),
                variant_a_ssml=str(payload["variantA"]["ssml"]),
                variant_b_ssml=str(payload["variantB"]["ssml"]),
                variant_a_label=str(payload["variantA"]["label"]),
                variant_b_label=str(payload["variantB"]["label"]),
                voice_name=str(payload.get("voiceName") or ""),
                lexicon_version=payload.get("lexiconVersion"),
            )
        except (KeyError, TypeError, ValueError) as err:
            return jsonify({"error": f"invalid payload: {err}"}), 400
        saved = service.create_item(item)
        return jsonify(saved.to_dict()), 201

    @bp.get("/items")
    def list_items():
        _, guard = _guard()
        if guard is not None:
            return guard
        target_sound = request.args.get("sound")
        limit = int(request.args.get("limit", "50"))
        items = service.list_active_items(target_sound=target_sound, limit=limit)
        return jsonify({"items": [i.to_dict() for i in items]})

    @bp.get("/items/<item_id>")
    def get_item(item_id: str):
        _, guard = _guard()
        if guard is not None:
            return guard
        item = service.get_item(item_id)
        if item is None:
            return jsonify({"error": "not found"}), 404
        return jsonify(item.to_dict())

    @bp.delete("/items/<item_id>")
    def retire_item(item_id: str):
        _, guard = _guard()
        if guard is not None:
            return guard
        ok = service.retire_item(item_id)
        if not ok:
            return jsonify({"error": "not found or already retired"}), 404
        return jsonify({"status": "retired"})

    @bp.post("/items/<item_id>/vote")
    def vote(item_id: str):
        user, guard = _guard()
        if guard is not None:
            return guard
        assert user is not None
        payload = request.get_json(silent=True) or {}
        try:
            vote = service.record_vote(
                item_id=item_id,
                therapist_user_id=str(user.get("id")),
                workspace_id=payload.get("workspaceId"),
                preferred_variant=str(payload.get("preferredVariant") or "").lower(),
                confidence=int(payload.get("confidence") or 0),
                rationale=payload.get("rationale"),
            )
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        return jsonify({"voteId": vote.id}), 201

    @bp.post("/rewards/refresh")
    def refresh_rewards():
        _, guard = _guard()
        if guard is not None:
            return guard
        rewards = service.refresh_rewards()
        return jsonify(
            {
                "count": len(rewards),
                "rewards": [r.to_dict() for r in rewards],
            }
        )

    @bp.get("/rewards")
    def list_rewards():
        _, guard = _guard()
        if guard is not None:
            return guard
        stats = service.total_vote_stats()
        rewards = service.list_rewards()
        return jsonify(
            {
                "stats": stats,
                "rewards": [r.to_dict() for r in rewards],
            }
        )

    @bp.get("/export.csv")
    def export_csv():
        _, guard = _guard()
        if guard is not None:
            return guard
        csv_text = service.export_votes_csv()
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=listening-eval-votes.csv"
            },
        )

    @bp.get("/dpo-pairs")
    def dpo_pairs():
        _, guard = _guard()
        if guard is not None:
            return guard
        min_conf = int(request.args.get("minConfidence", "3"))
        pairs = build_dpo_preference_pairs(service, min_confidence=min_conf)
        return jsonify({"count": len(pairs), "pairs": pairs})

    return bp
