# Phase 3 — voicelab autoscaling (DRAFT diff, NOT applied)

**Status:** drafted for review. **Do not apply** without explicit go-ahead — this
changes shared staging/prod infra (replica ceiling + scale rule) and therefore
real Azure spend.

## Why

Today the `voicelab` Container App is pinned to a single replica:

```bicep
scaleMinReplicas: 1
scaleMaxReplicas: 1
```

So every staging load ramp measures **one container's ceiling**, not how the
system scales. Until this is applied, the `learning_tutor.js` / `learning_voice.js`
staging ramps are explicitly capped and the reports say so. This change adds a
KEDA HTTP-concurrency scale rule and lifts the ceiling so the system can fan out
under load.

## Diff

File: `infra/resources.bicep`, the `module voicelab 'br/public:avm/res/app/container-app:0.8.0'` block.

```diff
-    scaleMinReplicas: 1
-    scaleMaxReplicas: 1
+    scaleMinReplicas: 1
+    scaleMaxReplicas: 10
+    scaleRules: [
+      {
+        name: 'http-concurrency'
+        http: {
+          metadata: {
+            // Scale out when a replica exceeds ~50 concurrent in-flight requests.
+            // Tune against the staging ramp: lower = earlier scale-out (more
+            // replicas, more spend), higher = later (cheaper, higher tail latency).
+            concurrentRequests: '50'
+          }
+        }
+      }
+    ]
```

## Notes / knobs

- `scaleMaxReplicas: 10` is a starting ceiling — size it to the staging quota and
  cost appetite before applying. Confirm Container Apps replica quota in the
  target region first.
- `concurrentRequests: 50` is the scale-out trigger. The right value is empirical:
  run the staging ramp, watch per-replica latency, and pick the concurrency where
  p95 starts to climb.
- Voice (`/ws/learning-voice`) holds **long-lived** WebSocket connections. KEDA
  HTTP concurrency counts active requests, so a long WS counts continuously —
  good for scale-out, but verify the app's `ingressTransport`/session affinity
  behaviour and consider a separate revision/replica budget if voice and text
  contend.
- Keep `scaleMinReplicas: 1` so staging stays warm (no cold-start surprises in
  the dashboards).

## Apply (only after approval)

```bash
# from repo root, with the right subscription/env selected
az deployment group what-if -g <rg> -f infra/main.bicep -p <params>   # review
azd provision                                                          # or apply
```

Validate the diff compiles first (no infra change):

```bash
az bicep build --file infra/resources.bicep --stdout > /dev/null
```
