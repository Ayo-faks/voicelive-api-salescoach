# Session Screen Redesign Plan

## Goal

Redesign the active session screen into an avatar-first experience while preserving the current instant-start path: exercise click, launch overlay, prewarmed agent reuse, WebRTC avatar bootstrap, realtime messaging, and instant utterance scoring.

The safest implementation is to keep state and timing logic in `frontend/src/app/App.tsx` and move only the visible session composition into a new screen-level component.

## Steps

1. Preserve the current startup-critical flow in `frontend/src/app/App.tsx`.
   Do not change the existing `startPracticeSession`, `handleStart`, launch overlay, prewarming, `currentAgent` assignment, or the `avatarVideoReady` / `sessionReady` intro gating.

2. Add a dedicated session composition component.
   Create a screen-level component, likely `frontend/src/components/SessionScreen.tsx`, that receives session props from `App.tsx` and owns only layout and presentation.

3. Replace the current session branch in `frontend/src/app/App.tsx` with the new screen component.
   The avatar should become the visual anchor and stay mounted through all session states.

4. Refactor `frontend/src/components/ChatPanel.tsx`.
   Keep message rendering, connection messaging, and therapist controls, but stop using it as the primary session card. Reuse it as a transcript pane instead.

5. Implement a split layout by default in both child and therapist modes.
   Use an avatar pane on the left and transcript pane on the right at roughly `40/60` or `45/55`. Keep the avatar large enough for presence and animation.

6. Move the child-facing one-try microphone control beneath the avatar.
   Reuse the existing utterance recording callback chain from `App.tsx`.

7. Rework `frontend/src/components/ExerciseFeedback.tsx` into an inline results module.
   Render it beneath the avatar so results appear instantly in place after recording stops.

8. Keep therapist mode on the same overall layout system.
   Preserve the current analyze workflow and assessment modal in `frontend/src/app/App.tsx` unless intentionally redesigned later.

9. Expand `frontend/src/components/VideoPanel.tsx` styling.
   Make it work as the hero region without changing its video lifecycle, fallback avatar behavior, or `onVideoLoaded` callbacks.

10. Verify the second-session restart path, disconnect/reconnect behavior, transcript flow, inline utterance results, and mobile collapse behavior after the layout swap.

## Relevant Files

- `frontend/src/app/App.tsx`
- `frontend/src/components/ChatPanel.tsx`
- `frontend/src/components/VideoPanel.tsx`
- `frontend/src/components/ExerciseFeedback.tsx`
- `frontend/src/components/SessionLaunchOverlay.tsx`
- `frontend/src/hooks/useRealtime.ts`
- `frontend/src/hooks/useWebRTC.ts`
- `frontend/src/hooks/useRecorder.ts`
- `frontend/src/components/ChildHome.tsx`

## Verification

1. Click an exercise and confirm the launch overlay appears immediately and the avatar still renders as fast as it does now.
2. Confirm the avatar remains visible before, during, and after recording, with inline results appearing immediately after stop.
3. Confirm transcript messages stream correctly in both child and therapist modes.
4. Confirm going home and starting a second session still works without the stuck-session regression.
5. Run the frontend build and targeted session-related checks.
6. Verify mobile behavior so the avatar and primary mic action remain dominant.

## Decisions

- Apply the redesign to both child and therapist modes.
- Show transcript by default.
- Show pronunciation results inline below the avatar after recording stops.
- Do not change backend session logic or the existing startup lifecycle.

## UX Note

Transcript-on by default is workable for therapist mode, but it may still be visually noisy for child mode. If testing shows distraction, switch child mode to transcript-collapsed by default without changing the architecture.

## Implementation Note

Prefer introducing a dedicated `SessionScreen` wrapper rather than overloading `App.tsx` further. Keep `App.tsx` as the state owner and move layout concerns out of the startup-critical logic.