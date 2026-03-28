# Fix: Second Session Attempt Gets Stuck

## Problem

After completing a practice session and returning home, starting a second session would get permanently stuck on the "Lisa is getting ready" overlay. The avatar never greeted the child and the microphone never unlocked.

First session always worked. Only subsequent sessions on the same page load were affected.

## Root Causes (Two Independent Bugs)

### Bug 1: WebSocket not torn down between sessions

**File:** `frontend/src/hooks/useRealtime.ts`

The `useRealtime` hook opened a single WebSocket on mount and kept it alive across sessions. When the user went home (`handleGoHome`), `currentAgent` was set to `null` but the WebSocket stayed connected.

The backend `websocket_handler.py` follows a one-shot design: `handle_connection()` reads one `session.update` message, opens an Azure VoiceLive connection, then enters a blind forwarding loop (`_forward_client_to_azure` / `_forward_azure_to_client`). It never watches for subsequent `session.update` messages.

On the second session, the frontend sent a new `session.update` with a new agent ID. The backend blindly forwarded it to Azure as raw JSON. Azure didn't recognize the local `agent_id` field and silently ignored it. The backend never sent back `proxy.connected` or `session.updated`, so `sessionReady` never became `true`.

### Bug 2: `pendingIntroRef` nulled after first greeting, never repopulated

**File:** `frontend/src/app/App.tsx`

The greeting effect at line ~744 sent the intro then set `pendingIntroRef.current = null`. The effect that populates `pendingIntroRef` depended on `[activeAvatarName, activeAvatarPersona, activeScenario?.description, activeScenario?.name, isChildMode, selectedChild?.name, selectedScenario]`. When the same exercise was selected for the second session, none of these deps changed, so the effect didn't re-run and `pendingIntroRef.current` stayed `null`.

The greeting trigger effect checked `!pendingIntroRef.current` and bailed. No greeting was ever sent, so `assistantSpeechStarted` stayed `false` and the overlay (which waits for `!assistantSpeechStarted` in child mode) never dismissed.

## How We Debugged

### Step 1: Reproduced with Playwright

Automated the full flow: navigate → child mode → start session 1 → go home → start session 2. Confirmed session 1 worked, session 2 stuck on overlay.

### Step 2: Intercepted WebSocket messages

Injected WS monitoring via `page.evaluate` to track all send/receive messages. Found that on the second attempt, the frontend correctly sent `session.update` with a new agent ID, but received no `proxy.connected` or `session.updated` back from the backend.

### Step 3: Read backend WebSocket handler

Read `backend/src/services/websocket_handler.py`. Found:
- `_get_agent_id_from_client()` reads exactly ONE message at startup
- After connecting to Azure, enters `_handle_message_forwarding()` which blindly pipes all messages
- No logic to intercept or handle new `session.update` messages mid-stream

### Step 4: Applied WebSocket disconnect fix and retested

Added `disconnect()` to `useRealtime`, called it in `handleGoHome`. Retested with Playwright. The WS now closed cleanly and reconnected for session 2. Backend logs confirmed a fresh Azure session was created.

But the overlay still persisted.

### Step 5: Added debug logging to WebRTC and greeting flow

Added `console.log` to `handleWebRTCMessage`, `setupWebRTC`, `handleAnswer`, and `ontrack` in `useWebRTC.ts`. Retested. Logs showed:

**Session 1:** `session.updated` → `setupWebRTC resolved` → ICE complete → SDP answer → `handleAnswer` (pcRef: true, state: have-local-offer) → `ontrack: video, videoRef: true` → greeting sent → overlay dismissed.

**Session 2:** Identical WebRTC trace — all steps succeeded including `onVideoStreamReady` callback. But no greeting appeared and overlay stayed.

### Step 6: Identified pendingIntroRef bug

Since `avatarVideoReady` was set (ontrack fired), `sessionReady` was set (session.updated received), and `sessionIntroRequested` was `false` (reset by startPracticeSession), the only remaining guard was `!pendingIntroRef.current`. Traced the ref lifecycle and found it was set to `null` after the first greeting and never repopulated because the populating effect's deps didn't change.

## Fixes Applied

### Fix 1: WebSocket lifecycle (useRealtime.ts)

```typescript
// Added disconnect function
const disconnect = useCallback(() => {
  manualCloseRef.current = true
  clearReconnectTimer()
  closeSocket()
  lastSessionAgentIdRef.current = null
  setConnected(false)
  setConnectionState('disconnected')
}, [clearReconnectTimer, closeSocket])

// Updated agentId effect to reconnect after disconnect
useEffect(() => {
  const nextAgentId = options.agentId || null
  if (!nextAgentId) return

  const socket = wsRef.current
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    manualCloseRef.current = false
    void connect()
    return
  }

  if (lastSessionAgentIdRef.current === nextAgentId) return

  lastSessionAgentIdRef.current = nextAgentId
  socket.send(JSON.stringify({
    type: 'session.update',
    session: { agent_id: nextAgentId },
  }))
}, [options.agentId, connect])
```

### Fix 2: Call disconnect in handleGoHome (App.tsx)

```typescript
const handleGoHome = useCallback(() => {
  disconnect()  // <-- added
  clearMessages()
  // ... rest of state resets
}, [clearMessages, clearStreamingAudioRecording, clearUtteranceAudioRecording, disconnect])
```

### Fix 3: Don't null pendingIntroRef after sending greeting (App.tsx)

```diff
  send({
    type: 'response.create',
    response: {
      modalities: ['audio', 'text'],
      instructions: pendingIntroRef.current,
    },
  })
- pendingIntroRef.current = null
  setSessionIntroRequested(true)
```

`setSessionIntroRequested(true)` already prevents double-sending within a session, and `startPracticeSession` resets it to `false` for the next session.

## Verification

Full Playwright test: session 1 → home → session 2 → avatar greets, overlay dismisses, microphone unlocks. Both sessions work identically. Frontend build passes with no errors.
