"""Standalone real-socket WebSocket broker for the learner voice transport.

Mounts the *real* ``/ws/learning-voice`` frame broker —
:class:`LearnerVoiceSocketHandler`, the exact handler ``app.py`` wires onto
``flask_sock`` in production — on a real socket so ``k6`` can open many concurrent
voice sockets and measure **your broker** (connect + auth + JSON frame relay),
not Azure VoiceLive's bill.

Honesty / cost boundary (this is the whole point of the harness):

* In production the browser streams **audio directly to Azure VoiceLive**; the
  backend only authenticates the socket and brokers JSON frames. So load on
  *your* code is the connection + frame-relay cost — which is exactly what this
  server exposes. **No audio ever touches Azure here.**
* The upstream "brain" is in-process. Two modes:
    - default: the **real** ``LearningApi().run_assistant_turn`` (in-memory repo,
      no DB, no model for the practice-card path) so you measure the genuine
      relay + planning cost.
    - ``--fixture-brain``: a trivial echo brain that isolates pure transport
      (connect/auth/frame relay) cost from any planning work.
* Auth is **stubbed open** (empty ``owned_child_ids``) so the smoke needs no
  principal headers. In staging the deployed socket authenticates via
  ``X-MS-CLIENT-PRINCIPAL*`` exactly as ``app.py`` does — this runner is for the
  hermetic broker smoke only.

Usage:
    python loadtest/serve_learning_voice.py --host 127.0.0.1 --port 8789
    python loadtest/serve_learning_voice.py --fixture-brain   # transport-only
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Any, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from flask_sock import Sock  # noqa: E402  pyright: ignore[reportMissingTypeStubs]

from src.learning.api import LearningApi  # noqa: E402
from src.services.learner_voice_websocket_handler import (  # noqa: E402
    LearnerVoiceSocketHandler,
)

logger = logging.getLogger(__name__)


def _fixture_run_turn(payload: Mapping[str, Any]) -> dict:
    """Trivial echo brain: isolates pure connect/auth/frame-relay cost.

    Returns the same ``{"blocks": [...]}`` shape the real brain does so the k6
    client's frame contract is identical in both modes.
    """
    question = str(payload.get("question") or "").strip()
    return {
        "blocks": [
            {
                "kind": "prose",
                "speak": f"ack:{question[:48]}" if question else "ack",
            }
        ],
        "session_complete": False,
    }


def build_app(*, fixture_brain: bool = False) -> Flask:
    os.environ.setdefault("PATHFINDER_LEARN_OBSERVABILITY_ENABLED", "1")
    app = Flask(__name__)
    app.config["TESTING"] = True
    sock = Sock(app)

    if fixture_brain:
        run_turn = _fixture_run_turn
    else:
        run_turn = LearningApi().run_assistant_turn

    def learner_voice_socket(ws):
        # Hermetic broker: auth is stubbed open (empty owned set => no per-frame
        # child binding required), mirroring the production handler wiring minus
        # the X-MS-CLIENT-PRINCIPAL* gate that app.py applies before this point.
        handler = LearnerVoiceSocketHandler(
            ws,
            run_turn=run_turn,
            owned_child_ids=set(),
            bind_scope=None,
            default_payload={"user_id": "loadtest-learner"},
        )
        try:
            handler.run()
        finally:
            try:
                ws.close()
            except Exception:  # noqa: BLE001 — best-effort close on teardown.
                logger.debug("voice smoke socket close failed", exc_info=True)

    sock.route("/ws/learning-voice")(learner_voice_socket)
    return app


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="local learner-voice broker smoke server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8789)
    parser.add_argument(
        "--fixture-brain",
        action="store_true",
        help="use a trivial echo brain to isolate pure transport cost",
    )
    args = parser.parse_args(argv)

    app = build_app(fixture_brain=args.fixture_brain)
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
