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

export type AskOpenRequest = { mode: AskSurfaceMode; nonce: number }

export type AskSurfaceValue = {
  /** Latest programmatic open request; the drawer effects on `nonce`. */
  openRequest: AskOpenRequest | null
  /** Open the Ask Wulo surface in the given mode (defaults to text). */
  openAsk: (mode?: AskSurfaceMode) => void
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

  const openAsk = useCallback((mode: AskSurfaceMode = 'text') => {
    nonceRef.current += 1
    setOpenRequest({ mode, nonce: nonceRef.current })
  }, [])

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
