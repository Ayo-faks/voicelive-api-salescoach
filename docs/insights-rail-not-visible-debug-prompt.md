# Debug prompt — InsightsRail not visible on dashboard (regression)

**Repo:** `/home/ayoola/sen` (monorepo). The app lives in `voicelive-api-salescoach/`.

**Stack:** React 18 + TypeScript + Vite 7 frontend (`voicelive-api-salescoach/frontend`), Flask backend on :8000, SQLite at `voicelive-api-salescoach/data/wulo.db`, venv at `/home/ayoola/sen/.venv`. The real `.env` is at `voicelive-api-salescoach/.env` — NOT at `/home/ayoola/sen/.env`.

## Symptom
On `http://localhost:5173/dashboard?childId=...&sessionId=...` the right-hand **Insights rail** (chat panel with voice orb + composer, `data-testid="insights-rail"`) is not visible. The user says "it used to be visible on the right side where we could expand and collapse." A recent screenshot shows the dashboard cards occupying the full width with no rail/column on the right, and no 48px collapsed strip either.

## What was attempted (and didn't fix it)
1. Capped rail height in `voicelive-api-salescoach/frontend/src/components/InsightsRail.tsx` (`root` + `rootFull` now have `height: calc(100vh - 32px)` and `maxHeight: calc(100vh - 32px)`) so the composer wouldn't be pushed off-fold. Rail still not visible.
2. In `voicelive-api-salescoach/frontend/src/components/ProgressDashboard.tsx` lowered the `matchMedia('(min-width: 1280px)')` viewport gate on `isLargeViewport` down to `960px`. Still not visible. Browser viewport was measured at **vw=943**, vh=338 — so even 960 fails. At vw=943 the grid column for the rail probably also won't fit (main content + 360px + sidebar).

## Key files & relevant symbols
- `voicelive-api-salescoach/frontend/src/components/ProgressDashboard.tsx`
  - `isLargeViewport` (around line 1806): `matchMedia('(min-width: 960px)')` — currently gates mounting.
  - `shouldMountInsightsRail = insightsRailEnabled && isLargeViewport` (~line 1882).
  - `insightsRailEnabled` prop (default `false`, line ~1780) — **check whether the parent passes `true`**.
  - Render at ~line 4093: `{shouldMountInsightsRail ? (<aside className={styles.railContainer} ...><InsightsRail ... /></aside>) : null}`.
  - Styles: `layoutWithRail` (grid `minmax(0, 1fr) 360px`), `layoutWithRailCollapsed` (`... 48px`), `layoutWithRailFull` (`... 0px`), `railContainer` (`position: sticky; top: 16px`).
- `voicelive-api-salescoach/frontend/src/components/InsightsRail.tsx` — exports `readStoredInsightsRailMode()` reading localStorage key `wulo.insightsRail.mode` (values `'collapsed' | 'normal' | 'full'`).
- Backend feature flag env var: `INSIGHTS_RAIL_ENABLED=true` in `voicelive-api-salescoach/.env`. Search `grep -rn "insights_rail_enabled\|insightsRailEnabled\|INSIGHTS_RAIL" voicelive-api-salescoach --include="*.ts" --include="*.tsx" --include="*.py"` to trace how the flag flows to the dashboard component props.
- Git: branch `main`, last committed is `87459c3` (backend planner raw_dict fix). 3 uncommitted files on top: `InsightsRail.tsx`, `InsightsRail.test.tsx`, `ProgressDashboard.tsx`. Do NOT push.

## Diagnostic checklist (do these in order)
1. **Check the feature flag prop chain.** Find who renders `<ProgressDashboard ... />` and whether it passes `insightsRailEnabled={true}`. The default is `false`. `grep -rn "ProgressDashboard" voicelive-api-salescoach/frontend/src`. Likely culprit: an API/config value that maps `INSIGHTS_RAIL_ENABLED` from `/api/config` or similar onto the prop — verify backend returns it and frontend consumes it.
2. **Use Playwright evaluate on the live page** (pageId `f3a03793-cb1c-47f3-8ee7-89c3ee8413ef`) to confirm which branch we're in:
   ```js
   return page.evaluate(() => ({
     vw: window.innerWidth,
     rail: !!document.querySelector('[data-testid="insights-rail"]'),
     sticky: !!document.querySelector('[aria-label="Insights assistant"]'),
     layout: document.querySelector('[class*="layoutWithRail"]')?.getBoundingClientRect(),
   }));
   ```
   If `rail: false` AND `sticky: false` → `shouldMountInsightsRail` is false. Check `insightsRailEnabled` prop (flag pipeline), not viewport.
3. **Verify via git history** when this last worked. `git log --oneline -- voicelive-api-salescoach/frontend/src/components/ProgressDashboard.tsx | head -20` and `git diff HEAD~5 -- voicelive-api-salescoach/frontend/src/components/ProgressDashboard.tsx` to see what changed around the rail mount.
4. **Once fixed, verify in the already-open browser tab** (pageId above). Reload with Ctrl+Shift+R equivalent via `navigate_page` type `reload`. Do NOT restart servers unless dev server actually died — check `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/` and `http://localhost:8000/api/health` first.

## Expected fix (hypothesis)
The `insightsRailEnabled` prop is probably being passed as `false` by the parent. Either:
- The backend `/api/config` (or whatever endpoint exposes it) doesn't emit the flag, OR
- The frontend config loader doesn't map `INSIGHTS_RAIL_ENABLED` → `insightsRailEnabled` prop.

Trace from `INSIGHTS_RAIL_ENABLED` in `backend/src/config.py` → the response serializer → the frontend config hook → the `ProgressDashboard` parent. Fix the missing link. Do NOT hardcode `true`.

## Non-goals / guardrails
- Don't refactor the rail component itself — it's been rewritten this session and tests pass (`npx vitest run src/components/InsightsRail.test.tsx` → 7/7).
- Don't push to origin. Don't `azd deploy`. Local only.
- Don't create docs/markdown files unless asked.
- Don't add new features (no TTS, WS, deep research) — just restore rail visibility.

## Done criteria
- Rail (`[data-testid="insights-rail"]`) visible on the dashboard at typical desktop viewport, expandable to full-screen (`⤢`), collapsible to 48px strip (`✕`), mode persisted to `localStorage`.
- `vitest run src/components/InsightsRail.test.tsx` still 7/7.
- No regression in `ProgressDashboard.test.tsx` (run it).
