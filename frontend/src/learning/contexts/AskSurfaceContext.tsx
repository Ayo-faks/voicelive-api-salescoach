// Imperative bridge into the Ask Wulo overlay (PRD: Home Activation F1/F3).
// Home-surface affordances (intent chips, the voice entry card) call
// `openAsk(mode)`; the mounted AskPathfinder drawer effects on the request
// nonce and opens itself in the requested mode. When no provider (or no
// drawer) is mounted — e.g. parent persona — `useAskSurface()` returns null
// and callers hide their ask affordances instead of rendering dead buttons.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type AskSurfaceMode = 'text' | 'voice'

/**
 * An optional study intent carried by an open request. When present, the Ask
 * surface seeds a practice turn on open so the assistant returns a tutor card
 * and the surface renders in its focused "tutor" presentation — the unified
 * replacement for the standalone LearnerTutorFullscreen entry point.
 */
export type AskStudyIntent = {
  kind: 'study'
  skillId: string | null
  skillLabel: string | null
}

export type AskOpenRequest = {
  mode: AskSurfaceMode
  nonce: number
  intent?: AskStudyIntent
}

export type AskSurfaceValue = {
  /** Latest programmatic open request; the drawer effects on `nonce`. */
  openRequest: AskOpenRequest | null
  /**
   * Open the Ask Wulo surface in the given mode (defaults to text). Pass a
   * study `intent` to seed a tutor session — the surface dispatches a practice
   * turn on open and morphs into its focused tutor presentation.
   */
  openAsk: (mode?: AskSurfaceMode, intent?: AskStudyIntent) => void
  /**
   * True when the drawer was dismissed mid voice conversation. Drives the
   * voice entry card's "Resume session" variant (F3.4). Reset on reopen.
   */
  voiceSessionDismissed: boolean
  setVoiceSessionDismissed: (value: boolean) => void
}

const AskSurfaceContext = createContext<AskSurfaceValue | null>(null)

export function AskSurfaceProvider({ children }: { children: ReactNode }) {
  const [openRequest, setOpenRequest] = useState<AskOpenRequest | null>(null)
  const [voiceSessionDismissed, setVoiceSessionDismissed] = useState(false)
  const nonceRef = useRef(0)

  const openAsk = useCallback(
    (mode: AskSurfaceMode = 'text', intent?: AskStudyIntent) => {
      nonceRef.current += 1
      setOpenRequest({ mode, nonce: nonceRef.current, intent })
    },
    []
  )

  const value = useMemo(
    () => ({
      openRequest,
      openAsk,
      voiceSessionDismissed,
      setVoiceSessionDismissed,
    }),
    [openRequest, openAsk, voiceSessionDismissed]
  )

  return (
    <AskSurfaceContext.Provider value={value}>
      {children}
    </AskSurfaceContext.Provider>
  )
}

/** Null outside an AskSurfaceProvider — callers should hide ask affordances. */
export function useAskSurface(): AskSurfaceValue | null {
  return useContext(AskSurfaceContext)
}
