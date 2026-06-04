"""Standalone real-socket server for the agent-mesh score route (load smoke).

The in-process B3 tests round-trip through a Flask ``test_client`` (no sockets),
which is hermetic but cannot be driven by an external load tool. This tiny
runner mounts the *real* ``/internal/agent-mesh/score`` blueprint on a real TCP
socket so ``k6`` (or any HTTP load tool) can hammer it locally — used by the
``loadtest-smoke`` make target and the CI k6 smoke job.

It is deliberately minimal and synthetic-only:

* It arms the route's two dark-by-default flags (``AGENT_MESH_ENABLED`` +
  ``AGENT_MESH_SCORE_ROUTE_V1``) **in this process only** so the local smoke can
  exercise the route. It never touches a deployed environment.
* It mounts only the score blueprint (which classifies through the same offline
  ``population_fixture_handler`` the route uses in staging), so there is no DB,
  no model, and no learner data anywhere near it.
* The *real* staging load run does NOT use this runner — k6 points straight at
  the deployed staging app. This runner exists so the k6 script + SLO thresholds
  can be validated cheaply and hermetically in CI.

Usage:
    python loadtest/serve_score_route.py --host 127.0.0.1 --port 8787
    # optional shared secret the k6 script can present as a bearer token:
    AGENT_MESH_SCORE_TOKEN=s3cr3t python loadtest/serve_score_route.py
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402

from src.learning.agent_mesh_routes import (  # noqa: E402
    MESH_ENABLED_FLAG,
    SCORE_ROUTE_FLAG,
    create_agent_mesh_blueprint,
)


def build_app() -> Flask:
    """Arm the route flags (process-local) and mount the score blueprint."""
    os.environ.setdefault(MESH_ENABLED_FLAG, "1")
    os.environ.setdefault(SCORE_ROUTE_FLAG, "1")
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(create_agent_mesh_blueprint())
    return app


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="local agent-mesh score smoke server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args(argv)

    app = build_app()
    # Single-threaded werkzeug dev server is enough for a 1-VU smoke; the real
    # load run targets deployed staging, not this process.
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
