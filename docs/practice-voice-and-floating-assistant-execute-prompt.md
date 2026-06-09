# Execution prompt — Practice voice‑answer + floating help assistant

> Paste this into a **new agent session** with the `voicelive-api-salescoach` repo open.
> The full design rationale and verified code map live in
> [`docs/practice-voice-and-floating-assistant-plan.md`](./practice-voice-and-floating-assistant-plan.md).
> **Read that file first**, then implement the plan exactly. Do not re‑litigate the
> locked decisions below.

---

## Role

You are implementing a two‑part frontend change in `voicelive-api-salescoach`
(branch `feat/pathfinder-learn-ownership-multichild`). Work in small, verified
increments. After each phase, run the gates and fix anything red before moving on.
Do **not** create summary markdown files. Do **not** push or open PRs without being asked.

## Locked decisions (do not change)

1. Reuse the realtime `/ws/voice` path for practice voice‑answers — no separate STT‑to‑REST.
2. Treat the staging "Talk to tutor does nothing" as a real WS/mic bug and fix it.
3. The help FAB is **global** across the learner home, in floating mode.
4. Keep "Voice on" (TTS‑out). Only remove the top "🎙️ Talk to tutor" chip.
5. Keep the existing **text** "Ask Pathfinder" drawer working — the new floating **voice**
   assistant must coexist with it.

## Scope (implement in order)

**Phase 0 — Extract the voice engine** (blocks A & B)
- Extract WS `/ws/voice` + `useRecorder('stream')` + state machine + audio/barge‑in from
  `frontend/src/learning/components/LearnerTutorFullscreen.tsx` into a reusable headless
  hook `useLearnerVoiceSession`. Re‑implement `LearnerTutorFullscreen` on top of it with
  **no behaviour change** (keep `LearnerTutorFullscreen.test.tsx` green).
- Fix connectivity/permission: surface a **visible error state** instead of a silent orb
  when the WS fails or mic permission is denied.

**Phase A — Practice card voice answer**
- In `frontend/src/learning/components/PracticeFullscreen.tsx`: mount the engine **inline**
  (not `position: fixed`) beneath the still‑mounted card; add a persistent bottom **mic**
  + a small Listening/Thinking/Speaking indicator. The question card must never unmount.
- Map a spoken answer to the correct `mcq-tap` turn via the WS card path; pass the current
  `card_id` so WS drives subsequent cards. Keep tap‑to‑answer working. Make one source
  authoritative for the visible card while voice is active.
- **Delete** the "🎙️ Talk to tutor" chip (~L335), its `setTutorOpen`, and the nested
  `LearnerTutorFullscreen` mount (~L369). Keep the "Voice on" toggle.

**Phase B — Floating, theme‑aware help assistant**
- Add `--scrim-orb-bg` (+ speaking/thinking glow) tokens with **light and dark** variants
  in `frontend/src/learning/theme/pathfinderThemeStyles.ts`; replace the hard‑coded orb
  gradient in `LearnerTutorFullscreen.tsx` (~L86) so the orb follows the theme.
- Add a presentation mode `'floating' | 'fullscreen'`: floating corner panel (chrome from
  `--pf-*` tokens) with an expand→fullscreen / collapse→floating control; the engine stays
  mounted across the resize so the session survives.
- Add a **global Help FAB** in `frontend/src/learning/routes/StudentLearningHome.tsx`
  that opens the assistant in floating mode, reusing existing `tutorOpen` / `focusItem`
  plumbing. Do not break the existing text Ask Pathfinder FAB.

## Testing — exercise EVERY feature with Playwright (mock the socket)

Use `page.routeWebSocket('**/ws/voice', …)` to drive deterministic voice flows (no live
Azure). Add/extend specs under `frontend/e2e/`:

- **Practice (a):** at `/home?startPractice=1` assert the card is visible, the bottom mic
  is present, the top "Talk to tutor" chip is **absent**, "Voice on" still toggles, a
  mocked spoken answer advances the card **without unmounting it**, and mic‑denied shows a
  visible error (not a silent orb).
- **Floating (b):** global Help FAB opens the floating assistant; expand → fullscreen orb
  stage; collapse → floating; close. Assert the WS session stays alive across
  expand/collapse.
- **Theme:** extend `frontend/e2e/pathfinder-theme.spec.ts` — in light **and** dark assert
  the orb background resolves from the themed CSS variable (computed style differs between
  modes; no fixed `#101012`), and the floating panel uses `--pf-*` surfaces.
- **Regression:** keep these green — `pathfinder-ask-assistant.spec.ts`,
  `pathfinder-voice.spec.ts`, `learner-voice-ss3.spec.ts`, `pathfinder-end-to-end.spec.ts`,
  `pathfinder-routes.spec.ts`.

Also add Vitest coverage for `useLearnerVoiceSession` state transitions, the practice
spoken‑answer→`mcq-tap` mapping, the chip removal, and the floating↔fullscreen toggle
keeping the session mounted.

## Evaluations — prove no learning regression

- Run the backend test suite (`cd backend && pytest`) and the learner‑voice / card eval
  parity: confirm `card_id` continuity through the WS path and that **voice answers score
  identically to tap answers**. Use `data/exercises/*` prompts and `backend/tests` as the
  baseline; compare pass‑rate before vs after and report the delta.

## Gates (all must pass before you call it done)

```bash
cd frontend
npm run lint
npm run build          # tsc + vite
npm test               # vitest
npm run test:e2e       # playwright — all specs
npm run capture:flow-assets   # refresh real-app flow screenshots; eyeball mic + themed orb
cd ../backend && pytest        # + eval parity
```

## Definition of done

- Practice screen: one coherent surface — question always visible, bottom mic works
  (tap **or** speak), no top "Talk to tutor" chip, "Voice on" intact.
- Floating help assistant: themed orb in light/dark, `--pf-*` chrome, expand/collapse
  fullscreen with a surviving session, opened from a global FAB; text Ask Pathfinder still
  works.
- All gates green; e2e covers every new feature; eval parity shows no regression.
- Report a concise summary of files changed, specs added, and the eval pass‑rate delta.
