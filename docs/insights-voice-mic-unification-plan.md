# Insights Voice — Composer Mic Unification Plan

**Status:** Draft, ready for review. No code written yet.
**Date:** 2026-04-22
**Related:** `docs/insights-voice-rollout-plan-v2.md`, `docs/insights-voice-rollout-implementation-prompt.md`

## Context

Today the Insights rail has two disjoint voice entry points:

1. `insights-rail-voice-toggle` — "Start voice" button row, wired to
   `useInsightsVoice.start/stop` (real voice session).
2. `insights-rail-voice-action` — composer-footer mic, labelled "Talk to Wulo",
   whose `onClick` only calls `focusComposer` (not a real voice starter).

Users click the composer mic expecting voice and nothing happens. Meanwhile, when
Start voice fails (permission denied, AudioWorklet load error, WS error), the hook
silently resets to `idle` so the user sees no feedback.

## Goal

When `INSIGHTS_VOICE_MODE !== 'off'`, the **composer mic becomes the single
start/stop voice control**. The separate `insights-rail-voice-toggle` row is
removed. Recorder / permission errors surface inline instead of a silent reset.

When `INSIGHTS_VOICE_MODE === 'off'`, the rail DOM stays byte-identical to today
(composer mic still focuses the textarea).

## Constraints

- Feature-flag gated by `INSIGHTS_VOICE_MODE` (`off | push_to_talk | full_duplex`).
  Off path must remain byte-identical (existing `InsightsRail.test.tsx` byte-identical
  test must still pass).
- Deny-list untouched: `useRealtime.ts`, `websocket_handler.py`, `managers.py`,
  `prompt_rules.py`, `scoring.py`, `/ws/voice`, practice-session routes, Alembic
  migrations, `requirements.txt`, `package.json`.
- No backend changes. No `/api/config` shape changes.
- Single additive commit. Revertable by setting `INSIGHTS_VOICE_MODE=off`.

## Design

### Phase A — Lift voice state

Move `useInsightsVoice()` out of the `InsightsVoiceControls` subcomponent
(`InsightsRail.tsx` L722–788) up into `InsightsRail` itself, so the composer footer
and the orb share one voice state. When `insightsVoiceMode === 'off'`, skip the
hook entirely (early-return stub) to preserve byte-identicality.

Delete `InsightsVoiceControls` and the `voiceToggleRow` (with
`insights-rail-voice-toggle`). Keep the orb render (L776–786) mounted in the same
slot in the rail body — do not relocate it near the composer in this commit
(layout/a11y tests stay stable).

### Phase B — Rewire composer mic

In the composer footer (L1293–1315), make the voice-action button conditional on
`insightsVoiceMode` and `voiceState`:

| Mode / State              | onClick         | aria-label          | visual                |
| ------------------------- | --------------- | ------------------- | --------------------- |
| `off` (any)               | `focusComposer` | "Talk to Wulo"      | unchanged             |
| on + `idle`               | `start()`       | "Start voice"       | mic icon              |
| on + `error`              | `start()`       | "Retry voice"       | mic icon + inline err |
| on + `connecting`         | disabled        | "Connecting…"       | spinner affordance    |
| on + `listening`          | `stop()`        | "Stop listening"    | active / aria-pressed |
| on + `thinking`           | `stop()`        | "Stop"              | muted active          |
| on + `speaking`           | `stop()` (→ interrupt) | "Interrupt"  | active                |

Keep `data-testid="insights-rail-voice-action"` stable. Add `data-voice-state` for
tests/debug. Retain `insights-orb-interrupt` stop button on the orb unchanged.

### Phase C — Surface errors

In `useInsightsVoice.ts` `start()` (L473–490), on recorder/WS failure:

- Set `voiceState = 'error'` (already in type union).
- Store a short `lastError: string | null` on hook state; expose in return type.
- Clear on next successful `start()`.

Render `lastError` as small inline text near the composer mic when
`voiceState === 'error'`. Auto-clears on retry. No toast, no modal.

### Phase D — Tests

Update `InsightsRail.test.tsx`:

- Replace the mock at L29 so it exposes `start`/`stop` **spies** and a settable
  `voiceState` + `lastError` via a module-level controller. Default state: `idle`,
  no error.
- Rewrite the L325–343 test "swaps the composer action…" into two cases:
  - `insightsVoiceMode="off"`: clicking mic focuses textarea (current behaviour).
  - `insightsVoiceMode="push_to_talk"`: clicking mic calls `start` spy when idle;
    after a state transition to `listening`, clicking calls `stop`; button reflects
    `aria-pressed` and label transitions.
- Add a new rail test: when hook reports `voiceState='error'` with `lastError`,
  inline error text renders and retry click calls `start`.
- Keep the "mode-off markup byte-identical" test passing.

Extend `useInsightsVoice.test.tsx`:

- Add case where `getUserMedia` (or `toggleRecording`) rejects → `voiceState`
  becomes `'error'`, `lastError` populated.

### Phase E — Verify

1. Targeted slice: `InsightsRail` + `InsightsOrb` + `useInsightsVoice`.
2. Full frontend + backend gates (target: 378 backend / ≥33 frontend green).
3. Optional localhost push-to-talk smoke with `INSIGHTS_VOICE_MODE=push_to_talk`.

## Files in scope

- `frontend/src/components/InsightsRail.tsx` — lift hook, rewire composer voice
  action, delete `InsightsVoiceControls` subcomponent.
- `frontend/src/hooks/useInsightsVoice.ts` — add `lastError` state + `'error'`
  transition in `start()` failure branch.
- `frontend/src/components/InsightsRail.test.tsx` — rewrite the composer-action
  test; add error-state test.
- `frontend/src/hooks/useInsightsVoice.test.tsx` — add error-state test.
- `/memories/repo/voicelive-api-salescoach.md` — append: "single voice entry point
  is the composer mic when `INSIGHTS_VOICE_MODE != off`; do not reintroduce a
  separate toggle row."

## Verification checklist

- `npm run test -- InsightsRail InsightsOrb useInsightsVoice` green.
- Full frontend + backend suites still green.
- DOM structural check with flag `off`: identical test-id set to pre-change.
- Manual localhost push-to-talk:
  - Click composer mic → permission prompt → listening (aria-pressed=true, label
    "Stop listening").
  - Speak → partial/final transcripts → speaking state → TTS audible.
  - Click mic mid-speech → `turn.interrupted` → idle.
  - Deny permission → inline error text shown near mic, mic remains clickable to
    retry.

## Decisions

- `insights-rail-voice-toggle` removed outright (never shipped externally).
- Orb stays in rail body; not relocated near composer in this commit.
- Single additive commit; revertable by flag.

## Further considerations (not in this commit)

1. First-run mic-permission hint — rely on the browser prompt for now (simpler);
   revisit if users report friction.
2. Listening indication on the mic button itself: pulse mic icon + orb
   (recommended), since the button is now the control.
3. Keyboard shortcut (⌘⇧V) to toggle voice — follow-up.
