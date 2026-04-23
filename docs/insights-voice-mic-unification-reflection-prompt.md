# Reflection Prompt — Insights Voice Mic Unification Plan

Paste this into a new session to get a fresh, critical review of the plan before
implementation begins.

---

## Role

You are a senior React/TypeScript + accessibility reviewer for a Flask + React 19
repo (`voicelive-api-salescoach`). You have not seen this plan before. Be blunt,
specific, and prioritised.

## Context to load

Please read these files before reviewing:

1. `docs/insights-voice-mic-unification-plan.md` — the plan under review.
2. `docs/insights-voice-rollout-plan-v2.md` — the parent rollout plan that landed
   Commits 1–3 (REST STT/TTS, SDK streaming, barge-in).
3. `frontend/src/components/InsightsRail.tsx` — especially:
   - `InsightsVoiceControls` subcomponent around L722–788.
   - Composer footer and voice-action button around L1293–1315.
4. `frontend/src/hooks/useInsightsVoice.ts` — focus on `start()` around L473–490
   and the failure path that silently resets to `idle`.
5. `frontend/src/hooks/useRecorder.ts` — `audioWorklet.addModule` (L77) and
   `getUserMedia` (L96) failure points.
6. `frontend/src/components/InsightsRail.test.tsx` — mock at L29 and the test at
   L325–343 that asserts current focusComposer behaviour; also the mode-off
   byte-identical test near L400–415.
7. `frontend/src/types/index.ts` — `InsightsVoiceState` union around L484.
8. `/memories/repo/voicelive-api-salescoach.md` — repo conventions.

## What to produce

A review with these sections, in this exact order:

### 1. Verdict
One line: proceed as-is / proceed with the following changes / do not proceed.

### 2. Correctness risks
- Does lifting the hook into `InsightsRail` cause unintended re-subscription /
  WebSocket churn on unrelated re-renders? Identify the hot props.
- Will the byte-identical-off test still pass? Where is the risk?
- Are there any hook-ordering or conditional-hook violations in the "skip hook
  when off" approach? Suggest a concrete pattern if so.
- Race/cancellation concerns around the `start()` → error path (e.g. pending
  connect promise, recorder transition queue).

### 3. UX & accessibility
- Critique the state → label/aria-pressed table in the plan. Anything ambiguous
  or violating ARIA authoring practices?
- Should the composer mic also show a visible focus/listening pulse, or is
  `aria-pressed` + the orb sufficient?
- How should screen-reader users be told that voice started/stopped/errored?
- Mic-permission failure copy suggestion (one short sentence).

### 4. Test strategy critique
- Is the plan's mock-with-settable-state approach sound, or should the real
  `useInsightsVoice` be tested via a thin integration harness? Concrete
  recommendation.
- Name one test missing from the plan that would catch a regression you expect.

### 5. Rollout safety
- Is a single commit the right granularity, or should Phase C (error surfacing)
  ship separately?
- Anything in the deny-list that could accidentally be touched?

### 6. Concrete diffs to the plan
Bullet list of edits you'd make to `docs/insights-voice-mic-unification-plan.md`
before implementation starts. Keep each bullet to one sentence.

### 7. Go/no-go
Restate verdict with any gating conditions.

## Constraints

- Do not write implementation code in this review.
- Do not run tools that modify files. Read-only exploration only.
- Keep the review under ~500 words. Prioritise signal over completeness.
