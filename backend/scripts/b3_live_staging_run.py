"""Bounded LIVE B3 ramp against the deployed staging score route.

Drives synthetic persona turns through the real ``StagingHttpTurnHandler`` →
HTTPS → the deployed ``/internal/agent-mesh/score`` route on staging-sen.wulo.ai
→ the in-app classifier → durable sink. Session counts are deliberately small so
the shared staging app is exercised, not hammered.

Run (operator owns the go-live):
    AGENT_MESH_ENABLED=1 AGENT_MESH_B3_DRIVER_V1=1 \
    AGENT_MESH_B3_STAGING_HANDLER_V1=1 \
    B3_SCORE_TOKEN=... B3_BASE_URL=https://staging-sen.wulo.ai \
    python scripts/b3_live_staging_run.py
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Mapping

from src.agents.durable_sink import InMemoryDurableSink
from src.learning.eval.b3_driver import (
    B3Config,
    B3Driver,
    CaptureSinkNotifier,
    make_capacity_probe,
)
from src.learning.eval.b3_staging_handler import (
    B3StagingTargetError,
    build_staging_handler,
)

# Cloudflare fronts staging and 403s the default Python-urllib User-Agent, so the
# live transport presents a browser UA. Everything else mirrors the handler's own
# stdlib transport; this only sets a header, it fabricates nothing.
_BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _browser_ua_transport(timeout: float):
    def _post(
        url: str, body: Mapping[str, Any], headers: Mapping[str, str]
    ) -> Mapping[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", _BROWSER_UA)
        for key, value in headers.items():
            req.add_header(key, value)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8") or "{}"
        decoded = json.loads(raw)
        if not isinstance(decoded, Mapping):
            raise B3StagingTargetError("staging score endpoint returned non-object JSON")
        return decoded

    return _post


def main() -> int:
    base_url = os.environ["B3_BASE_URL"].strip()
    token = os.environ.get("B3_SCORE_TOKEN") or None
    operator = os.environ.get("B3_OPERATOR", "ayo").strip()
    out_path = os.environ.get("B3_REPORT_PATH", "data/c1/b3_live_staging_report.json")

    # Real handler: every persona turn becomes a live HTTPS POST to staging.
    handler = build_staging_handler(
        base_url,
        operator=operator,
        token=token,
        timeout=20.0,
        transport=_browser_ua_transport(20.0),
    )
    print(f"live handler url : {handler.url}")

    sink = InMemoryDurableSink()
    notifier = CaptureSinkNotifier(sink)

    # Low capacity ceilings so the bounded live ramp surfaces a bend point
    # (a probe is unhealthy once step sessions exceed its limit). db ceiling 25
    # bends at the 30-session step, keeping total live requests small.
    probes = (
        make_capacity_probe("websocket_concurrency", 80),
        make_capacity_probe("token_volume", 120),
        make_capacity_probe("db_write_throughput", 25),
        make_capacity_probe("sink_ingest_rate", 200),
    )

    cfg = B3Config(
        environment="staging-sen.wulo.ai",
        operator=operator,
        notifier=notifier,
        sink=sink,
        target_sessions=10,
        max_sessions=30,
        ramp_step=10,
        concurrency=4,
        component_probes=probes,
    )

    driver = B3Driver(handler=handler)
    started = time.time()
    report = driver.run(cfg, force=True)  # go-live action; flags + gate enforced
    wall = time.time() - started

    d = report.as_dict()
    total_records = 0
    for s in d["steps"]:
        bent = [r["component"] for r in s["readings"] if not r["healthy"]]
        total_records += s["sink_records"]
        print(
            f"step {s['step']:>2} sessions={s['sessions']:>3} "
            f"live_records={s['sink_records']:>4} "
            f"throughput={s['throughput']} "
            f"bent={bent or '-'}"
        )

    counts = sink.counts_by_kind()
    print(f"first_bend       : {d['first_bend']}")
    print(f"peak_sessions    : {d['peak_sessions']}")
    print(f"total live records: {total_records}")
    print(f"sink counts      : {counts}")
    print(f"wall clock       : {wall:.1f}s")

    enriched = {
        "mode": "live-staging-http",
        "base_url": base_url,
        "score_url": handler.url,
        "operator": operator,
        "wall_clock_s": round(wall, 2),
        "total_live_records": total_records,
        "sink_counts": counts,
        "report": d,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(enriched, indent=2))
    print(f"WROTE {out_path}")
    print("B3_LIVE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
