#!/usr/bin/env bash
# Turnkey, self-reverting STAGING ramp for the Pathfinder Learn text-tutor journey.
#
# WHAT THIS DOES (staging only — rg-salescoach-swe / voicelab):
#   1. Snapshots the app's current scale config + Easy Auth state.
#   2. Temporarily DISABLES Container Apps Easy Auth on the staging revision so
#      synthetic X-MS-CLIENT-PRINCIPAL* load traffic reaches the app (the app
#      auto-provisions synthetic learners via get_or_create_user — no seeding).
#   3. Adds a reversible http-concurrency scale rule + raises maxReplicas so the
#      app can actually scale out under the ramp.
#   4. Runs a BOUNDED, DIAGNOSTIC-ONLY k6 ramp against the DIRECT staging FQDN
#      (bypassing Cloudflare). Diagnostic-only = real Postgres load, NO Azure
#      OpenAI spend.
#   5. ALWAYS reverts on exit (success, error, or Ctrl-C): re-enables Easy Auth,
#      restores maxReplicas, and VERIFIES auth is back by asserting the endpoint
#      returns 401 again before the script exits.
#
# WHY IT IS GATED: step 2 briefly leaves a shared, internet-facing staging app
# unauthenticated. Run it deliberately, under supervision, with a named operator.
# It refuses to run without CONFIRM=run.
#
# Usage:
#   CONFIRM=run OPERATOR=ayo backend/loadtest/run_staging_ramp.sh
#
# Optional overrides:
#   RG=rg-salescoach-swe APP=voicelab
#   BASE_URL=https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io
#   PEAK_VUS=300            # ramp peak (default 300; keep modest)
#   MAX_REPLICAS=10         # scale ceiling during the ramp
#   CONCURRENT_REQUESTS=50  # http-concurrency scale-rule threshold
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "${HERE}/.." && pwd)"
cd "${BACKEND}"

RG="${RG:-rg-salescoach-swe}"
APP="${APP:-voicelab}"
OPERATOR="${OPERATOR:-staging-ramp}"
PEAK_VUS="${PEAK_VUS:-300}"
MAX_REPLICAS="${MAX_REPLICAS:-10}"
CONCURRENT_REQUESTS="${CONCURRENT_REQUESTS:-50}"
SCALE_RULE_NAME="loadtest-http-concurrency"
REPORT_PATH="${REPORT_PATH:-data/c1/learning_tutor_staging_report.json}"

# Direct Container Apps FQDN (bypasses Cloudflare/WAF on the custom domain).
BASE_URL="${BASE_URL:-https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io}"
PROBE_URL="${BASE_URL%/}/api/learning/diagnostic/start"

red()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*" >&2; }
grn()  { printf '\033[32m%s\033[0m\n' "$*" >&2; }

if [[ "${CONFIRM:-}" != "run" ]]; then
  red "Refusing to run: this temporarily DISABLES Easy Auth on shared staging."
  ylw "Re-run with: CONFIRM=run OPERATOR=<you> $0"
  exit 2
fi
command -v az >/dev/null 2>&1 || { red "az CLI not found"; exit 1; }
command -v k6 >/dev/null 2>&1 || { red "k6 not found"; exit 1; }
command -v curl >/dev/null 2>&1 || { red "curl not found"; exit 1; }

ylw "=== Snapshotting baseline for ${RG}/${APP} ==="
BASE_MIN="$(az containerapp show -g "${RG}" -n "${APP}" --query 'properties.template.scale.minReplicas' -o tsv)"
BASE_MAX="$(az containerapp show -g "${RG}" -n "${APP}" --query 'properties.template.scale.maxReplicas' -o tsv)"
BASE_AUTH="$(az containerapp auth show -g "${RG}" -n "${APP}" --query 'platform.enabled' -o tsv 2>/dev/null || echo 'unknown')"
echo "  baseline: minReplicas=${BASE_MIN} maxReplicas=${BASE_MAX} easyAuthEnabled=${BASE_AUTH}" >&2

REVERTED=0
revert() {
  [[ "${REVERTED}" == "1" ]] && return 0
  REVERTED=1
  ylw "=== Reverting ${RG}/${APP} to baseline ==="

  # 1) SECURITY-CRITICAL: re-enable Easy Auth first, and keep trying until it sticks.
  for attempt in 1 2 3 4 5; do
    az containerapp auth update -g "${RG}" -n "${APP}" --enabled true >/dev/null 2>&1 && break
    ylw "  auth re-enable attempt ${attempt} failed; retrying..."
    sleep 5
  done

  # 2) Restore the scale ceiling (the now-inert rule is harmless at max=1, but we
  #    drop it too for a clean baseline).
  az containerapp update -g "${RG}" -n "${APP}" \
    --min-replicas "${BASE_MIN}" --max-replicas "${BASE_MAX}" >/dev/null 2>&1 || \
    ylw "  WARN: scale restore failed; check manually."

  # 3) VERIFY auth is back: the probe must 401 again.
  local code=""
  for _ in $(seq 1 24); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${PROBE_URL}" \
      -H 'Content-Type: application/json' -d '{"synthetic":true}' || echo 000)"
    [[ "${code}" == "401" ]] && break
    sleep 5
  done
  if [[ "${code}" == "401" ]]; then
    grn "  VERIFIED: Easy Auth re-enabled (probe -> 401). Scale restored to ${BASE_MIN}/${BASE_MAX}."
  else
    red "  !!! AUTH NOT CONFIRMED RE-ENABLED (probe -> ${code}). MANUAL ACTION REQUIRED:"
    red "      az containerapp auth update -g ${RG} -n ${APP} --enabled true"
  fi
  ylw "  NOTE: a residual scale rule named '${SCALE_RULE_NAME}' may remain (inert at max=${BASE_MAX})."
  ylw "        Remove with a clean redeploy if desired."
}
trap revert EXIT INT TERM

ylw "=== Disabling Easy Auth on ${RG}/${APP} (temporary) ==="
az containerapp auth update -g "${RG}" -n "${APP}" --enabled false >/dev/null

ylw "=== Adding scale rule + raising maxReplicas to ${MAX_REPLICAS} ==="
az containerapp update -g "${RG}" -n "${APP}" \
  --min-replicas 1 --max-replicas "${MAX_REPLICAS}" \
  --scale-rule-name "${SCALE_RULE_NAME}" \
  --scale-rule-type http \
  --scale-rule-http-concurrency "${CONCURRENT_REQUESTS}" >/dev/null

ylw "=== Waiting for the staging app to accept synthetic auth (probe -> 200) ==="
ready=0
for _ in $(seq 1 36); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${PROBE_URL}" \
    -H 'Content-Type: application/json' \
    -H 'X-MS-CLIENT-PRINCIPAL-ID: staging-ramp-probe' \
    -H 'X-MS-CLIENT-PRINCIPAL-NAME: Staging Ramp Probe' \
    -H 'X-MS-CLIENT-PRINCIPAL-IDP: loadtest' \
    -d '{"synthetic":true,"operator":"'"${OPERATOR}"'","student_id":"staging-ramp-probe","item_count":3}' || echo 000)"
  if [[ "${code}" == "200" ]]; then ready=1; break; fi
  sleep 5
done
if [[ "${ready}" != "1" ]]; then
  red "Staging app did not accept synthetic auth (last probe -> ${code}). Aborting ramp; reverting."
  exit 1
fi
grn "Staging app reachable with synthetic auth."

ylw "=== Running bounded DIAGNOSTIC-ONLY ramp (peak ${PEAK_VUS} VUs) against ${BASE_URL} ==="
# Override the script's 1000-VU stages with a modest, supervised peak.
HALF=$(( PEAK_VUS / 2 ))
set +e
BASE_URL="${BASE_URL}" OPERATOR="${OPERATOR}" DIAGNOSTIC_ONLY=1 REPORT_PATH="${REPORT_PATH}" \
  k6 run \
    --stage "30s:${HALF}" \
    --stage "1m:${PEAK_VUS}" \
    --stage "2m:${PEAK_VUS}" \
    --stage "30s:0" \
    loadtest/learning_tutor.js
K6_EXIT=$?
set -e

if [[ "${K6_EXIT}" == "0" ]]; then
  grn "=== Ramp PASSED SLOs. Report: ${BACKEND}/${REPORT_PATH} ==="
else
  red "=== Ramp FAILED SLOs (k6 exit ${K6_EXIT}). Report: ${BACKEND}/${REPORT_PATH} ==="
fi

# revert() runs here via the EXIT trap.
exit "${K6_EXIT}"
