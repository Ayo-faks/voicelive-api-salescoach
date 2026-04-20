# PR12b — Two-Mode Mic Hybrid: Reflection & Non-Regression Audit

You are picking up work on the Wulo / voicelive-api-salescoach repo after
PR12b (the "Two-Mode Mic Hybrid") shipped across slices a → b.1 → b.2 →
b.3a → b.3b → b.3c.1 → b.3c.2 → b.3c.3 → b.3c.4.

Your job in this session is **audit-only first, then targeted fixes if needed**.
Do NOT introduce new features. Do NOT refactor. Do NOT add tests unless a
regression is found.

---

## Part 1 — Reflect on what shipped

Produce a short (≤ 25-line) written reflection covering:

1. **Scope recap.** In 3–5 bullets, summarise what each slice added:
   - PR12a: en-GB + postgres defaults.
   - PR12b.1: backend `conversational_mic_enabled`, semantic-VAD tunables,
     5 new WS protocol constants (`wulo.mic_mode`, `wulo.scored_turn.begin`
     / `.ack` / `.result` / `.end`).
   - PR12b.2: frontend `useMicMode` hook + Settings toggle.
   - PR12b.3a: backend `ScoredTurnDispatcher` + WS plumbing.
   - PR12b.3b: mode-aware VideoPanel copy via `videoPanelCopy.ts`.
   - PR12b.3c.1: pure `scoredTurnBridge.ts` helpers + App wiring.
   - PR12b.3c.2: panel `micMode` prop threading (prop-only).
   - PR12b.3c.3: App-level `handleScoredTurnBegin/End` callbacks +
     `composeScoredTurnBegin` helper + panel callback props.
   - PR12b.3c.4: WordPositionPracticePanel + TwoWordPhrasePanel PerformSlots
     actually fire `onScoredTurnBegin` / `onScoredTurnEnd`, gated on
     `micMode === 'conversational'`.

2. **Architecture picture.** One paragraph explaining the end-to-end data
   flow when a pilot toggles conversational mode and lands in PERFORM:
   Settings → `useMicMode` → App → `buildMicModeFrame` / `composeScoredTurnBegin`
   → WS → backend `ScoredTurnDispatcher` → `wulo.scored_turn.ack/result` →
   `handleScoredTurnServerEvent` → reducer.

3. **Invariants to preserve.** Explicitly list:
   - Tap mode is the default and must be behaviourally unchanged.
   - `useMicMode` reducer **rejects** `SCORED_TURN_START` outside conversational mode.
   - All new panel props (`micMode`, `onScoredTurnBegin`, `onScoredTurnEnd`) are **optional**.
   - `CONVERSATIONAL_MIC_ENABLED` defaults to `False` server-side.
   - `ScoredTurnDispatcher.resolve_with_assessment` is still stubbed (real
     Azure Speech SDK pronunciation-assessment wiring is deferred).

4. **Known deferred work.** List what PR12b explicitly did NOT do, so the
   audit doesn't flag these as bugs.

---

## Part 2 — Non-regression audit (read-only)

Run the following checks **without editing files**:

### 2a. Static integrity

- `cd voicelive-api-salescoach/frontend && npx tsc --noEmit` → expect clean.
- `cd voicelive-api-salescoach/backend && python -m mypy src` (if mypy.ini
  present) → expect no new errors vs. main.
- Grep for leftover dead props: `grep -rn "_onScoredTurnBegin\|_micMode" frontend/src`
  should only appear in `SoundIsolationPanel.tsx` / `VowelBlendingPanel.tsx`
  (panels that accept but intentionally don't use the props).

### 2b. Test suites

- **Frontend:** `cd frontend && npx vitest run --reporter=dot`
  → expect **26 files / 226 tests passing**.
- **Backend:** `cd backend && pytest -q`
  → expect **197 tests passing**.
- If either count is lower than expected, treat as regression.

### 2c. Tap-mode behavioural sanity (most important)

For each of these panels, confirm that with the default `micMode='tap'`:
- `SoundIsolationPanel`, `VowelBlendingPanel`, `WordPositionPracticePanel`,
  `TwoWordPhrasePanel` render and interact identically to pre-PR12b.
- No `wulo.scored_turn.*` frames are emitted (grep App.tsx: the `useEffect`
  in the two Perform slots must early-return on `micMode !== 'conversational'`).
- The existing `/api/assess-utterance` REST path for tap-mode scoring is
  still wired.

### 2d. Conversational-mode contract spot-check

Open these files and verify:
- `frontend/src/hooks/scoredTurnBridge.ts`: `composeScoredTurnBegin`
  defaults `windowMs` to `4000` and `referenceText` to `targetWord`.
- `frontend/src/hooks/useMicMode.ts`: `SCORED_TURN_START` reducer branch
  early-returns when `state.mode !== 'conversational'`.
- `frontend/src/app/App.tsx`: `handleScoredTurnBegin` calls BOTH
  `sendRef.current(frame)` AND `micMode.startScoredTurn(reducerTurn)`.
- `backend/src/config.py`: `DEFAULT_CONVERSATIONAL_MIC_ENABLED = False`.
- `backend` ScoredTurnDispatcher: still stubs pronunciation-assessment
  resolution (deferred work marker intact).

### 2e. WS protocol consistency

Grep for the 5 mic-mode constants across frontend + backend and confirm
matching string literals on both sides:
- `wulo.mic_mode`
- `wulo.scored_turn.begin`
- `wulo.scored_turn.ack`
- `wulo.scored_turn.result`
- `wulo.scored_turn.end`

---

## Part 3 — Output format

Produce **one** markdown report with these sections:

```
## PR12b Reflection
...

## Audit Results
| Check | Status | Evidence |
|-------|--------|----------|
| tsc --noEmit (frontend) | ✅ / ❌ | ... |
| mypy (backend) | ✅ / ❌ / skipped | ... |
| vitest 226/226 | ✅ / ❌ | ... |
| pytest 197/197 | ✅ / ❌ | ... |
| Tap-mode no scored-turn frames | ✅ / ❌ | ... |
| reducer guard intact | ✅ / ❌ | file:line |
| CONVERSATIONAL_MIC_ENABLED=False | ✅ / ❌ | file:line |
| WS protocol constants symmetric | ✅ / ❌ | ... |

## Regressions Found
(empty if none — list file, line, expected vs. actual)

## Minimal Fix Plan
(only if regressions found; otherwise write "No fixes needed.")
```

---

## Rules of engagement

- **Read-only first.** Only edit files if an audit check fails AND the fix
  is small and obvious (e.g. a typo in a WS constant string).
- **Ask before big changes.** If a regression requires more than ~20 lines
  of edits, stop and present the fix plan for approval before writing code.
- **No new skills/tooling.** Do not install packages, do not add CI config.
- **Keep test counts as source of truth.** Frontend 226, backend 197 at
  PR12b.3c.4 tip. Any drift is significant.
