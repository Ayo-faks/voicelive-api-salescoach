# Transcript verdict inlining — deferred to Phase 4 (backend)

Status: **Deferred.** The shared `ConversationTurn` primitive
(`frontend/src/components/conversation/`) already accepts optional
`verdict` (`'correct' | 'retry' | 'off-target'`) and `targetPhoneme`
props, with styled chips wired up. No adoption site currently populates
them because the data is not in the payload yet.

## Why the frontend cannot light this up today

`parseTranscriptTurns()` in
[`frontend/src/components/ProgressDashboard.tsx`](../frontend/src/components/ProgressDashboard.tsx)
(around line 1527) only splits the stored `session.transcript` string
into `{ role, content }` turns. There is no structured verdict,
target phoneme, or utterance score attached to a turn either in the
live `Message` shape
([`frontend/src/types/index.ts`](../frontend/src/types/index.ts), L712)
or in the persisted session transcript.

Attribution today lives in a parallel surface — the celebration /
practice-point blocks inside `aiAssessment` — not in the transcript
itself. Rendering verdict chips in the transcript without that link
would require guessing, which is worse than showing no chip at all.

## Backend work required (Phase 4)

1. Persist per-utterance scoring alongside each transcript turn:
   - `turn_id` (stable per utterance)
   - `verdict: 'correct' | 'retry' | 'off-target'`
   - `target_phoneme?: string`
   - optional `score: number` and `evidence: string`
2. Extend the session / live-message wire format so the frontend
   receives these fields on both the live `Message` stream and the
   stored `session.transcript` (or a parallel `session.turns[]`).
3. Update `parseTranscriptTurns` (or replace with a structured reader)
   to return the new fields.

## Frontend follow-up (after backend lands)

In both adoption sites, map the new fields onto the already-supported
primitive props:

```tsx
<ConversationList
  turns={turns.map(t => ({
    role: t.role === 'user' ? 'child' : 'buddy',
    actorName: ...,
    content: t.content,
    verdict: t.verdict,        // new
    targetPhoneme: t.target_phoneme, // new
  }))}
/>
```

No primitive changes are expected — chip styling and copy are already
in place in `conversationStyles.ts` and `ConversationTurn.tsx`.
