#!/usr/bin/env bash
#
# agent_mesh_cron.sh — periodic agent-mesh observability cycle (Track A, increment 7).
#
# DARK BY DEFAULT. This wrapper invokes the read-only observability gate. With
# AGENT_MESH_ENABLED unset the gate runs no agents and exits 0 (the cron is a
# no-op). Flipping the cron live is a deliberate operator action gated on the
# same flag as the rest of the mesh — this script never sets it.
#
# It records every verdict into the durable sink (when AGENT_MESH_MEMORY_SINK_V1
# is set) so the online drift detector has cross-run history to read. All probe
# suites stay dark behind their own per-suite flags.
#
# Usage (operator, once the go-live gate is approved):
#   AGENT_MESH_ENABLED=1 \
#   AGENT_MESH_MEMORY_SINK_V1=1 \
#   LEARNING_SAFEGUARDING_PROBES_V1=1 \
#   LEARNING_CRITIC_PROBES_V1=1 \
#     scripts/agent_mesh_cron.sh /var/lib/agent-mesh/history.jsonl
#
# Exit code is the gate's exit code (0 = healthy/disabled, 1 = blocked).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${HERE}/.." && pwd)"

# Optional first arg: durable-sink JSONL path (defaults to in-memory sentinel).
SINK_PATH="${1:--}"

PYTHON_BIN="${PYTHON_BIN:-python}"

# NOTE: the master-flag override is deliberately NOT passed. The cron honours the
# dark-by-default master flag so a misconfigured schedule can never run the mesh
# before its go-live gate.
exec "${PYTHON_BIN}" "${BACKEND_DIR}/scripts/run_observability_gate.py" \
  --metrics \
  --safeguarding \
  --critic \
  --durable-sink "${SINK_PATH}" \
  "${@:2}"
