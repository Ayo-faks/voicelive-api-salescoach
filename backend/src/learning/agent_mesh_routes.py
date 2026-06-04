"""Track B / B3 — server-side synthetic-scoring route (DARK / opt-in).

This is the *staging* counterpart to
:class:`~src.learning.eval.b3_staging_handler.StagingHttpTurnHandler`. The handler
POSTs each synthetic persona turn to ``/internal/agent-mesh/score``; this module
is the backend that answers it, so a B3 load run can drive *real HTTP* through
the deployed stack instead of an in-process fixture.

Safety rails (this route must never touch a real learner):

* **Dark by default.** The route only registers a live handler when both
  ``AGENT_MESH_ENABLED`` and ``AGENT_MESH_SCORE_ROUTE_V1`` are truthy. Otherwise
  every call returns ``404`` exactly as if the route did not exist.
* **Synthetic only.** A request without ``synthetic: true`` is rejected ``400``.
  The route never serves organic traffic.
* **Named operator.** A blank ``operator`` is rejected ``400`` — every load run
  is attributable.
* **Optional shared secret.** If ``AGENT_MESH_SCORE_TOKEN`` is set, the caller
  must present a matching ``Authorization: Bearer`` header or get ``401``.
* **No logic drift.** Outcomes come from the *same*
  :class:`~src.learning.eval.population_scorer.population_fixture_handler` the
  in-process B3 run uses, so the HTTP path and the fixture path classify
  identically.

The path lives under ``/internal/`` rather than ``/api/`` so it sidesteps the
learner-facing CSRF and per-actor rate-limit ``before_request`` guards (which are
scoped to ``/api/``) — a load run measures the mesh, not the rate limiter.
"""

from __future__ import annotations

import hmac
import os
from typing import Any, Mapping, Optional

from flask import Blueprint, jsonify, request

from src.learning.eval.personas import AGENT_TUTOR, PersonaTurn
from src.learning.eval.population_scorer import population_fixture_handler

# Master kill-switch (shared with the rest of the mesh) + per-route flag.
MESH_ENABLED_FLAG = "AGENT_MESH_ENABLED"
SCORE_ROUTE_FLAG = "AGENT_MESH_SCORE_ROUTE_V1"

# Optional shared secret. When set, callers must present it as a bearer token.
SCORE_TOKEN_ENV = "AGENT_MESH_SCORE_TOKEN"

SCORE_PATH = "/internal/agent-mesh/score"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def agent_mesh_score_route_enabled() -> bool:
    """Whether the synthetic-scoring route is opt-in live (mesh + route flag)."""
    return _flag(MESH_ENABLED_FLAG) and _flag(SCORE_ROUTE_FLAG)


def _truthy_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in _TRUTHY


def _token_ok() -> bool:
    expected = os.environ.get(SCORE_TOKEN_ENV, "").strip()
    if not expected:
        return True
    header = str(request.headers.get("Authorization") or "")
    prefix = "Bearer "
    if not header.startswith(prefix):
        return False
    presented = header[len(prefix) :].strip()
    # Constant-time compare so the route never leaks the secret via timing.
    return hmac.compare_digest(presented, expected)


def create_agent_mesh_blueprint(handler: Optional[Any] = None) -> Blueprint:
    """Build the ``/internal/agent-mesh/score`` blueprint.

    The blueprint is always registrable; the route stays dark (``404``) until
    both feature flags are set, so registering it in production is inert.
    ``handler`` defaults to the shared population fixture classifier and is
    injectable for tests.
    """
    bp = Blueprint("agent_mesh", __name__)
    classifier = handler or population_fixture_handler()

    @bp.route(SCORE_PATH, methods=["POST"])
    def score_synthetic_turn():
        # Dark unless both flags are set — indistinguishable from "no route".
        if not agent_mesh_score_route_enabled():
            return jsonify({"error": "not_found"}), 404

        if not _token_ok():
            return jsonify({"error": "unauthorized"}), 401

        payload = request.get_json(silent=True)
        if not isinstance(payload, Mapping):
            return jsonify({"error": "invalid_payload"}), 400

        if not _truthy_value(payload.get("synthetic")):
            # This route exists only for synthetic load. Refuse organic traffic.
            return jsonify({"error": "synthetic_required"}), 400

        operator = str(payload.get("operator") or "").strip()
        if not operator:
            return jsonify({"error": "operator_required"}), 400

        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            return jsonify({"error": "prompt_required"}), 400

        raw_meta = payload.get("metadata")
        metadata = dict(raw_meta) if isinstance(raw_meta, Mapping) else {}
        agent = str(payload.get("agent") or AGENT_TUTOR).strip() or AGENT_TUTOR

        # Classify through the SAME fixture handler the in-process B3 run uses.
        turn = PersonaTurn(
            prompt=prompt,
            expected_outcome="answer",  # handler never peeks at the label
            agent=agent,
            metadata=metadata,
        )
        result = classifier.handle(turn)

        body = {
            "outcome": result.get("outcome", "answer"),
            "synthetic": True,
            "operator": operator,
        }
        excerpt = result.get("response_excerpt")
        if excerpt is not None:
            body["response_excerpt"] = str(excerpt)
        return jsonify(body)

    return bp


__all__ = [
    "MESH_ENABLED_FLAG",
    "SCORE_ROUTE_FLAG",
    "SCORE_TOKEN_ENV",
    "SCORE_PATH",
    "agent_mesh_score_route_enabled",
    "create_agent_mesh_blueprint",
]
