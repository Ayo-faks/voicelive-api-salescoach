"""Standalone real-socket server for the Pathfinder Learn text tutor (load smoke).

Mounts the *real* ``/api/learning/*`` blueprint — the same ``register_learning_api``
the deployed app composes — on a real TCP socket so ``k6`` (or any HTTP load
tool) can drive the genuine tutor code locally. Used by the ``loadtest-text-smoke``
make target and the hermetic CI smoke.

Why this is hermetic and cheap:

* ``LearningApi()`` defaults to an **in-memory repository** and the diagnostic
  journey (``diagnostic/start`` -> ``diagnostic/answer`` xN) needs **no model and
  no DB**, so the real route code runs with nothing near Azure or Postgres.
* The ``_wrap`` view decorator only records observability spans/counters; auth
  and rate-limiting live in ``app.py``'s ``before_request`` middleware, which is
  *not* mounted here. So this exposes the real handler logic without the learner
  CSRF/rate-limit guards — exactly like ``serve_score_route.py`` does for the
  agent-mesh route. The load test measures the tutor, not the rate limiter.
* Prometheus learner metrics are on by default, so ``GET /api/learning/metrics``
  reflects the load this server serves (Phase 4 observability validation).

The *real* staging load run does NOT use this runner — k6 points straight at the
deployed staging app (``staging-sen.wulo.ai``). This runner exists so the k6
script + SLO thresholds can be validated cheaply and hermetically.

Usage:
    python loadtest/serve_learning_routes.py --host 127.0.0.1 --port 8788
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402

from src.learning.api import register_learning_api  # noqa: E402


def build_app() -> Flask:
    """Mount the real learning blueprint on a bare Flask app (no auth middleware)."""
    # Keep observability + Prometheus on so /api/learning/metrics is meaningful
    # under load; both default to enabled but we make the intent explicit.
    os.environ.setdefault("PATHFINDER_LEARN_OBSERVABILITY_ENABLED", "1")
    os.environ.setdefault("PATHFINDER_LEARN_PROMETHEUS_ENABLED", "1")
    app = Flask(__name__)
    app.config["TESTING"] = True
    register_learning_api(app)
    return app


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="local Pathfinder Learn text-tutor smoke server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args(argv)

    app = build_app()
    # threaded=True so a multi-VU k6 smoke isn't serialised on one connection;
    # the real load run targets deployed staging, not this single process.
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
