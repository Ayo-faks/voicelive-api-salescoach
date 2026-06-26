/**
 * Ask Pathfinder — the unified learner assistant surface.
 *
 * One brain, one transcript, two transports. The learner can type or talk to
 * the same assistant: ask a question, start an exercise, check their own
 * progress — and every reply comes back as a list of `AssistantBlock`s that
 * render through the shared {@link AssistantBlockRenderer}. A keyboard⟷mic
 * toggle morphs the same surface between a compact text drawer and a fullscreen
 * voice panel; the transcript persists across the switch.
 *
 * - Text turns POST `/api/learning/assistant/turn` (see {@link runAssistantTurn}).
 * - Voice turns stream over `/ws/learning-voice` (see {@link openLearnerVoiceSocket}),
 *   with speech-to-text at the edge and `block.speak` text-to-speech rendered
 *   through Azure neural TTS (`/api/learning/tts`) — the same warm voice
 *   VoiceLive uses, never the browser's robotic Web Speech engine.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { makeStyles, mergeClasses } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  PaperAirplaneIcon,
  PlusIcon,
  SparklesIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import {
  AssistantTurnTimeoutError,
  deleteAskConversation,
  getAskConversation,
  listAskConversations,
  openLearnerVoiceSocket,
  runAssistantTurn,
  type AskConversationMessage,
  type AskConversationSummary,
  type AssistantBlock,
  type AssistantConfirmationBlock,
  type AssistantThreadTurn,
  type AssistantTurnRequest,
  type AssistantTurnResult,
  type LearnerVoiceSocket,
} from './api'
import { AssistantBlockRenderer } from './components/AssistantBlockRenderer'
import { useAskSurface } from './contexts/AskSurfaceContext'
import { useLearnerContext } from './contexts/LearnerContext'
import { useAskPathfinderVoice } from './hooks/useAskPathfinderVoice'
import { useTtsPlayer } from './hooks/useTtsPlayer'
import { featureFlags } from '../utils/featureFlags'

type Mode = 'text' | 'voice'

type SpeakOptions = {
  force?: boolean
  prefix?: string
}

type DispatchTurnOptions = {
  forceSpeak?: boolean
  speakPrefix?: string
  bypassVoiceSocket?: boolean
}

type TranscriptItem =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; block: AssistantBlock }

const CARD_KINDS = new Set([
  'greeting',
  'mcq-tap',
  'explanation',
  'progress',
  'mark-known',
])

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

function sentenceLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return ''
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

// Map a saved-thread message (backend shape) into the live transcript items the
// renderer understands. Assistant turns carry one or more grounded blocks; a
// user turn carries plain text.
function messagesToTranscript(
  messages: AskConversationMessage[]
): TranscriptItem[] {
  const out: TranscriptItem[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ id: nextId('u'), role: 'user', text: message.text ?? '' })
    } else {
      for (const block of message.blocks ?? []) {
        out.push({ id: nextId('a'), role: 'assistant', block })
      }
    }
  }
  return out
}

// Compact, locale-aware label for a saved thread (e.g. "12 Jun, 14:30"). Falls
// back to the raw value if it cannot be parsed.
function formatHistoryDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// --- Local conversation persistence --------------------------------------
//
// Option A of conversation memory: the running transcript is mirrored to
// `localStorage`, keyed by child, so it survives a page reload, a cancelled
// voice session, or closing the drawer. This is a device-local rolling thread;
// durable, cross-device, multi-thread history is the backend follow-up.
const THREAD_STORAGE_PREFIX = 'pathfinder-ask-thread:'
// Cap the persisted tail so storage never grows unbounded on a long session.
const MAX_PERSISTED_ITEMS = 100

function threadStorageKey(childId: string): string {
  return `${THREAD_STORAGE_PREFIX}${childId}`
}

function loadThread(childId: string): TranscriptItem[] {
  if (typeof window === 'undefined' || !childId) return []
  try {
    const raw = window.localStorage.getItem(threadStorageKey(childId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TranscriptItem[]) : []
  } catch {
    return []
  }
}

function saveThread(childId: string, items: TranscriptItem[]): void {
  if (typeof window === 'undefined' || !childId) return
  try {
    const key = threadStorageKey(childId)
    if (items.length === 0) {
      window.localStorage.removeItem(key)
      return
    }
    const tail = items.slice(-MAX_PERSISTED_ITEMS)
    window.localStorage.setItem(key, JSON.stringify(tail))
  } catch {
    /* Quota or serialization failure — persistence is best-effort. */
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
      }) => void)
    | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

const useStyles = makeStyles({
  fab: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: 40,
    width: '60px',
    height: '60px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: 'linear-gradient(160deg, #3a3a3c 0%, #0a0a0a 100%)',
    boxShadow:
      '0 12px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.18)',
    transition:
      'transform .18s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow .15s ease, filter .15s ease',
    ':hover': {
      filter: 'brightness(1.08)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
      transform: 'translateY(-2px) scale(1.04)',
    },
    ':active': { transform: 'scale(0.92)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '4px',
    },
    '@media (max-width: 1000px)': {
      bottom: '88px',
      right: '16px',
      width: '54px',
      height: '54px',
    },
  },
  fabGlyph: { width: '24px', height: '24px' },
  drawer: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: 50,
    width: 'min(440px, calc(100vw - 48px))',
    height: 'min(660px, calc(100vh - 80px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: '18px',
    border: '1px solid var(--pf-line)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    background: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    transition: 'width .28s ease, height .28s ease, inset .28s ease',
    '@media (max-width: 700px)': {
      right: '0',
      left: '0',
      bottom: '0',
      width: '100vw',
      height: '85vh',
      borderRadius: '18px 18px 0 0',
    },
  },
  drawerVoice: {
    right: '24px',
    bottom: '24px',
    top: '24px',
    width: 'min(720px, calc(100vw - 48px))',
    height: 'auto',
    '@media (max-width: 700px)': {
      right: '0',
      left: '0',
      top: '0',
      bottom: '0',
      width: '100vw',
      height: '100vh',
      borderRadius: '0',
    },
  },
  // Tutor presentation: when the latest reply is a practice card, the surface
  // takes over the viewport and centres a single focused card — the unified
  // replacement for the standalone LearnerTutorFullscreen shell.
  drawerTutor: {
    right: '0',
    left: '0',
    top: '0',
    bottom: '0',
    width: '100vw',
    height: '100vh',
    maxWidth: '100vw',
    borderRadius: '0',
    border: 'none',
  },
  transcriptTutor: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorStage: {
    width: '100%',
    maxWidth: '560px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid var(--pf-line)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  title: { fontWeight: 600, fontSize: '15px' },
  switchBtn: {
    appearance: 'none',
    border: '1px solid var(--pf-line)',
    background: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    padding: '5px 12px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
    ':hover': { background: 'var(--pf-ink)', color: 'var(--pf-on-ink)' },
    ':disabled': { opacity: 0.4, cursor: 'not-allowed' },
  },
  switchGlyph: { width: '15px', height: '15px' },
  switchLabel: { whiteSpace: 'nowrap' },
  closeBtn: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'var(--pf-surface-muted)' },
    ':disabled': { opacity: 0.4, cursor: 'not-allowed' },
  },
  closeGlyph: { width: '18px', height: '18px' },
  closeBtnActive: {
    background: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
  },
  headerActions: { display: 'flex', alignItems: 'center', gap: '2px' },
  historyPanel: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  historyEmpty: {
    color: 'var(--pf-text-tertiary)',
    fontSize: '13px',
    padding: '8px 4px',
  },
  historyList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  historyItem: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '4px',
  },
  historyOpenBtn: {
    flex: 1,
    appearance: 'none',
    border: '1px solid var(--pf-line)',
    background: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    ':hover': { background: 'var(--pf-surface-muted)' },
  },
  historyItemActive: {
    borderTopColor: 'var(--pf-text-tertiary)',
    borderRightColor: 'var(--pf-text-tertiary)',
    borderBottomColor: 'var(--pf-text-tertiary)',
    borderLeftColor: 'var(--pf-text-tertiary)',
  },
  historyTitle: {
    fontSize: '14px',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  historyDate: {
    fontSize: '12px',
    color: 'var(--pf-text-tertiary)',
  },
  historyDeleteBtn: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'var(--pf-text-tertiary)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'var(--pf-surface-muted)', color: 'var(--pf-text)' },
  },
  historyDeleteGlyph: { width: '16px', height: '16px' },
  transcript: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontSize: '14px',
    lineHeight: 1.45,
  },
  msgUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    padding: '8px 12px',
    borderRadius: '12px 12px 4px 12px',
    background: 'var(--pf-surface-muted)',
  },
  typingRow: {
    alignSelf: 'flex-start',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '180px',
    maxWidth: '70%',
    padding: '11px 14px',
    borderRadius: '12px 12px 12px 4px',
    background: 'var(--pf-surface-muted)',
  },
  typingDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
  },
  typingDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--pf-text-tertiary)',
    animationName: {
      '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
      '40%': { opacity: 1, transform: 'translateY(-4px)' },
    },
    animationDuration: '1.2s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      opacity: 0.6,
    },
  },
  typingLabel: {
    fontSize: '12px',
    color: 'var(--pf-text-tertiary)',
    animationName: {
      from: { opacity: 0, transform: 'translateY(2px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    animationDuration: '0.35s',
    animationTimingFunction: 'ease-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
  shimmerLine: {
    height: '9px',
    borderRadius: '5px',
    backgroundImage:
      'linear-gradient(90deg, var(--pf-text-tertiary) 25%, var(--pf-surface-muted) 50%, var(--pf-text-tertiary) 75%)',
    backgroundSize: '200% 100%',
    opacity: 0.18,
    animationName: {
      '0%': { backgroundPosition: '200% 0' },
      '100%': { backgroundPosition: '-200% 0' },
    },
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
  shimmerLineShort: {
    width: '60%',
  },
  empty: { color: 'var(--pf-text-tertiary)', fontStyle: 'italic' },
  // A thin status strip shown just above the composer while live voice is
  // engaged — "Listening… / Wulo is speaking…" — instead of a full-screen orb.
  voiceStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '6px 16px 0',
  },
  voiceHint: { color: 'var(--pf-text-secondary)', fontSize: '13px', textAlign: 'center' },
  voiceError: { color: 'var(--pf-status-critical-fg)', fontSize: '13px', textAlign: 'center' },
  // Conspicuous "Wulo is thinking" badge for voice mode. Unlike the muted text
  // hint, this is a high-contrast ink pill with a breathing glow ring and
  // bouncing dots so it reads as "working on it" from across the room.
  voiceThinkingPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 18px',
    borderRadius: '999px',
    background: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.01em',
    animationName: {
      '0%': { boxShadow: '0 0 0 0 var(--pf-focus-ring)', transform: 'scale(1)' },
      '60%': { boxShadow: '0 0 0 14px rgba(0, 0, 0, 0)', transform: 'scale(1.015)' },
      '100%': { boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)', transform: 'scale(1)' },
    },
    animationDuration: '1.8s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
  voiceThinkingDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
  },
  voiceThinkingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--pf-on-ink)',
    animationName: {
      '0%, 80%, 100%': { opacity: 0.3, transform: 'translateY(0)' },
      '40%': { opacity: 1, transform: 'translateY(-5px)' },
    },
    animationDuration: '1.2s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
      opacity: 0.7,
    },
  },
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    padding: '10px 12px',
    borderTop: '1px solid var(--pf-line)',
  },
  textarea: {
    flex: 1,
    background: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
    border: '1px solid var(--pf-line)',
    borderRadius: '10px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '14px',
    resize: 'none',
    minHeight: '36px',
    maxHeight: '120px',
    outline: 'none',
    ':focus': {
      borderTopColor: 'var(--pf-text-tertiary)',
      borderRightColor: 'var(--pf-text-tertiary)',
      borderBottomColor: 'var(--pf-text-tertiary)',
      borderLeftColor: 'var(--pf-text-tertiary)',
    },
  },
  iconBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--pf-surface-muted)',
    color: 'var(--pf-text)',
    ':hover:not(:disabled)': { background: 'var(--pf-line)' },
    ':disabled': { opacity: 0.45, cursor: 'not-allowed' },
  },
  // The mic glows in the brand ink while a live voice session is recording, the
  // same affordance ChatGPT/Gemini use to show the bar's mic is hot.
  iconBtnMicActive: {
    background: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    ':hover:not(:disabled)': { background: 'var(--pf-ink)' },
  },
  iconGlyph: { width: '18px', height: '18px' },
  // ChatGPT-style "End" pill shown in the composer while a voice session is
  // live — one tap leaves voice and returns to typing.
  endBtn: {
    height: '36px',
    padding: '0 16px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    background: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    whiteSpace: 'nowrap',
    ':hover:not(:disabled)': { background: 'var(--pf-ink)' },
    ':disabled': { opacity: 0.45, cursor: 'not-allowed' },
  },
  endGlyph: { width: '16px', height: '16px' },
})

// ChatGPT-style voice "soundwave" glyph used as the composer's enter-voice
// affordance, in place of a plain microphone. Four rounded bars of varying
// height read as audio at any size; it inherits `currentColor`.
function VoiceWaveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="5" y1="9.5" x2="5" y2="14.5" />
      <line x1="9.5" y1="6" x2="9.5" y2="18" />
      <line x1="14.5" y1="4" x2="14.5" y2="20" />
      <line x1="19" y1="9.5" x2="19" y2="14.5" />
    </svg>
  )
}

// Staged copy shown while Wulo works on an answer. Purely presentational — the
// timings approximate the real pipeline (retrieval → generation → safety
// screen) so the wait reads as progress instead of a stall. The shimmer lines
// reserve the space where the answer will land, so the layout doesn't jump.
const THINKING_STAGES: ReadonlyArray<{ at: number; label: string }> = [
  { at: 0, label: 'Reading your sources…' },
  { at: 2500, label: 'Thinking it through…' },
  { at: 6500, label: 'Writing your answer…' },
]

// Staged "what Wulo is doing" label. While `active`, advances through
// THINKING_STAGES on their timers; resets to the first stage whenever a new
// wait begins. Shared by the text-mode ThinkingIndicator and the voice orb
// hint so both surfaces narrate the same pipeline.
function useThinkingStage(active: boolean): string {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    setStage(0)
    if (!active) return
    const timers = THINKING_STAGES.slice(1).map((entry, index) =>
      setTimeout(() => setStage(index + 1), entry.at)
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [active])
  return THINKING_STAGES[stage]?.label ?? THINKING_STAGES[0].label
}

function ThinkingIndicator(): JSX.Element {
  const styles = useStyles()
  const label = useThinkingStage(true)
  return (
    <output
      className={styles.typingRow}
      data-testid="ask-pathfinder-typing"
      aria-label="Wulo Tutor is thinking"
    >
      <span className={styles.typingDots}>
        <span
          className={styles.typingDot}
          style={{ animationDelay: '0ms' }}
        />
        <span
          className={styles.typingDot}
          style={{ animationDelay: '160ms' }}
        />
        <span
          className={styles.typingDot}
          style={{ animationDelay: '320ms' }}
        />
        <span className={styles.typingLabel} key={label}>
          {label}
        </span>
      </span>
      <span className={styles.shimmerLine} />
      <span
        className={mergeClasses(styles.shimmerLine, styles.shimmerLineShort)}
      />
    </output>
  )
}

export function AskPathfinder({
  voiceLiveEnabled = false,
  hideLauncher = false,
}: { voiceLiveEnabled?: boolean; hideLauncher?: boolean } = {}) {
  const styles = useStyles()
  const learner = useLearnerContext()
  const askSurface = useAskSurface()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('text')
  const [draft, setDraft] = useState('')
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [busy, setBusy] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceOpeningPrompt, setVoiceOpeningPrompt] = useState<
    string | null | undefined
  >(undefined)
  // Explicit tutor⟷ask switch. `null` means "follow the content" (a practice
  // card shows the focused tutor view; prose shows the conversational ask
  // view). The in-surface toggle button sets this so the learner can flip
  // between the full-screen tutor and the full-screen Ask Wulo / dig-deep view
  // and back, each replacing the other.
  const [presentationOverride, setPresentationOverride] = useState<
    'tutor' | 'ask' | null
  >(null)

  // Backend thread memory (Option B): the id of the saved conversation this
  // transcript belongs to. `null` means "a fresh thread" — the first persisted
  // turn mints one server-side and echoes the id back here. The history panel
  // lists past threads and resumes any of them.
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [conversations, setConversations] = useState<AskConversationSummary[]>(
    []
  )

  const socketRef = useRef<LearnerVoiceSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef<TranscriptItem[]>([])
  transcriptRef.current = transcript
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)

  // Ids of assistant blocks that arrived over a live transport *this session*.
  // Only these type themselves in; everything else — a localStorage rehydrate,
  // a thread resumed from history, reopening the drawer — renders instantly so
  // opening an old conversation never replays every answer. Cleared whenever
  // the transcript is replaced wholesale or the surface closes (a reopen
  // remounts every block, which must not re-animate).
  const liveIdsRef = useRef<Set<string>>(new Set())

  // Local conversation memory (Option A): rehydrate the child's saved thread on
  // mount and whenever the active child changes, then mirror every change back
  // to localStorage so the conversation survives reloads, cancelled voice
  // sessions, and closing the drawer. `skipNextSaveRef` suppresses the one save
  // that would otherwise fire in the same commit as a load — before the loaded
  // transcript has applied — which would clobber the new child's key with the
  // previous child's thread.
  const childId = learner.userId ?? ''
  const skipNextSaveRef = useRef(false)
  useEffect(() => {
    skipNextSaveRef.current = true
    liveIdsRef.current.clear()
    setTranscript(loadThread(childId))
    setSessionComplete(false)
    setConversationId(null)
  }, [childId])
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    saveThread(childId, transcript)
  }, [childId, transcript])

  // Keep the newest reply in view. A one-shot scroll on append isn't enough:
  // the assistant's answer types in (typewriter) and the "thinking" dots appear
  // *after* the effect runs, so the container keeps growing past the initial
  // scroll and the reply lands below the fold. We pin to the bottom on every
  // new turn, then a ResizeObserver follows the streaming text as it expands —
  // unless the learner has scrolled up to re-read, in which case we stop
  // yanking them back down.
  const turnCount = transcript.length
  const stickToBottomRef = useRef(true)
  const prevTurnCountRef = useRef(turnCount)
  useEffect(() => {
    // Re-run whenever a turn is appended or the thinking state toggles, so the
    // new streaming block is pinned and re-observed.
    void busy
    const node = transcriptScrollRef.current
    if (!node) return
    const distanceFromBottom = () =>
      node.scrollHeight - node.scrollTop - node.clientHeight
    const scrollToBottom = () => {
      node.scrollTop = node.scrollHeight
    }
    // The learner stays pinned to the latest line only while they are already
    // resting near the bottom; the scrollbar then tracks the stream naturally.
    const onScroll = () => {
      stickToBottomRef.current = distanceFromBottom() < 96
    }
    // Wheel/touch up is a stronger signal than the scroll position: release the
    // pin on the very first upward nudge so the streaming text can't yank the
    // learner back down before they clear the 96px threshold. This is what made
    // the scrollbar feel stuck — it would not budge until you hit the end.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stickToBottomRef.current = false
    }
    const onTouchStart = () => {
      stickToBottomRef.current = distanceFromBottom() < 96
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    // A brand-new turn should always reveal itself, even if the learner had
    // scrolled up during the previous answer. Streaming updates to the *same*
    // turn (busy toggles) must NOT re-pin — otherwise scrolling up to re-read
    // mid-answer keeps snapping back to the bottom.
    const isNewTurn = turnCount > prevTurnCountRef.current
    prevTurnCountRef.current = turnCount
    if (isNewTurn) stickToBottomRef.current = true
    // Defer past layout so the freshly-appended block has measured its height
    // before we scroll; a second frame catches the thinking dots that mount
    // just after the commit.
    const raf = requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
    })
    // A MutationObserver follows the streaming answer as it types in (text-node
    // edits) and any block appended asynchronously over the voice socket,
    // keeping the newest content in view — unless the learner has scrolled up
    // to re-read, in which case we stop yanking them back down.
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            if (stickToBottomRef.current) scrollToBottom()
          })
        : null
    observer?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      cancelAnimationFrame(raf)
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('touchstart', onTouchStart)
      observer?.disconnect()
    }
  }, [turnCount, busy])

  const speechSupported = useMemo(() => Boolean(getSpeechRecognition()), [])

  const buildContext = useCallback(
    (): AssistantTurnRequest => ({
      user_id: learner.userId,
      child_id: learner.userId,
      weak_topics: learner.weakTopics.map(w => ({
        skill_id: w.skillId,
        label: w.label,
      })),
      daily_plan: learner.dailyPlan.map(d => ({ id: d.id, title: d.title, skill_id: d.skillId })),
      career_fits: learner.careerFits,
      last_wrong_answer: learner.lastWrongAnswer
        ? {
            skill_id: learner.lastWrongAnswer.skillId,
            label: learner.lastWrongAnswer.label,
          }
        : null,
      focus_item: learner.focusItem
        ? {
            stem: learner.focusItem.stem,
            options: learner.focusItem.options,
            chosen: learner.focusItem.chosen,
            correct: learner.focusItem.correct,
            rationale: learner.focusItem.rationale,
            skill_id: learner.focusItem.skillId,
            misconception: learner.focusItem.misconception,
            scored: learner.focusItem.scored,
          }
        : null,
      learner_setup: learner.learnerSetup
        ? {
            subject: learner.learnerSetup.subject,
            year_group: learner.learnerSetup.yearGroup,
          }
        : null,
      attempt_history: learner.attemptHistory.map(a => ({
        misconception_code: a.misconceptionCode,
        topic: a.topic,
        correct: a.correct ?? false,
        occurred_at: a.occurredAt,
      })),
    }),
    [learner]
  )

  // The running conversation thread — user utterances and prose replies — so
  // the brain can ground multi-turn follow-ups. Cards carry their own state.
  const buildThread = useCallback((): AssistantThreadTurn[] => {
    const out: AssistantThreadTurn[] = []
    for (const item of transcriptRef.current) {
      if (item.role === 'user') {
        out.push({ role: 'user', text: item.text })
      } else if (item.block.kind === 'prose') {
        out.push({ role: 'assistant', text: item.block.text })
      }
    }
    return out
  }, [])

  // The last practice card shown, so a tap/utterance continues the same walk.
  const lastCard = useCallback((): { id: string; kind: string } | null => {
    for (let i = transcriptRef.current.length - 1; i >= 0; i -= 1) {
      const item = transcriptRef.current[i]
      if (item.role === 'assistant' && CARD_KINDS.has(item.block.kind)) {
        const card = item.block as { card_id: string; kind: string }
        return { id: card.card_id, kind: card.kind }
      }
    }
    return null
  }, [])

  // Azure neural TTS (the same warm voice VoiceLive uses), played through an
  // <audio> element. This deliberately replaces the browser's robotic Web
  // Speech engine so a tapped answer in voice mode is heard in the neural
  // voice, never the OS default male voice.
  const tts = useTtsPlayer()
  const ttsPlay = tts.play
  const ttsStop = tts.stop
  const speak = useCallback(
    (result: AssistantTurnResult, options: SpeakOptions = {}) => {
      if (!options.force && mode !== 'voice') return
      const line = [
        options.prefix ?? '',
        ...result.blocks.map(block => ('speak' in block ? block.speak : '')),
      ]
        .filter(Boolean)
        .join(' ')
      if (!line) return
      void ttsPlay(line)
    },
    [mode, ttsPlay]
  )

  const appendResult = useCallback((result: AssistantTurnResult) => {
    const items = result.blocks.map(block => ({
      id: nextId('a'),
      role: 'assistant' as const,
      block,
    }))
    for (const item of items) liveIdsRef.current.add(item.id)
    setTranscript(prev => [...prev, ...items])
    setSessionComplete(result.session_complete)
    // A fresh practice card means "practice resumed" — drop any manual ask
    // override so the focused tutor view surfaces it automatically.
    if (items.some(item => CARD_KINDS.has(item.block.kind))) {
      setPresentationOverride(null)
    }
  }, [])

  // VoiceLive emits one grounded, safeguarded block at a time over the realtime
  // socket; append it and clear the busy spinner. The neural voice is heard via
  // the audio player inside the hook, so no edge TTS here.
  const appendVoiceBlock = useCallback(
    (block: AssistantBlock, complete: boolean) => {
      const item = { id: nextId('a'), role: 'assistant' as const, block }
      liveIdsRef.current.add(item.id)
      setTranscript(prev => [...prev, item])
      setSessionComplete(complete)
      setBusy(false)
      if (CARD_KINDS.has(block.kind)) setPresentationOverride(null)
    },
    []
  )

  const appendUserUtterance = useCallback((text: string) => {
    setTranscript(prev => [
      ...prev,
      { id: nextId('u'), role: 'user' as const, text },
    ])
  }, [])

  const {
    voiceState: liveVoiceState,
    recording: liveRecording,
  } = useAskPathfinderVoice({
    active: open && mode === 'voice' && voiceLiveEnabled,
    childId: learner.userId ?? '',
    subject: learner.learnerSetup?.subject,
    classYear: learner.learnerSetup?.yearGroup,
    openingPrompt: voiceOpeningPrompt,
    onBlock: appendVoiceBlock,
    onUserTranscript: appendUserUtterance,
    onError: code => {
      setVoiceError(
        code === 'mic_denied'
          ? 'Microphone blocked. Allow mic access for this site, then tap again.'
          : code === 'missing_child_context'
            ? 'Learner context is still loading. Wait a second and try voice again.'
          : 'Voice connection hiccup — try again.'
      )
    },
  })

  const dispatchTurn = useCallback(
    async (
      partial: Partial<AssistantTurnRequest>,
      userText?: string,
      options: DispatchTurnOptions = {}
    ) => {
      if (busy) return
      if (userText) {
        setTranscript(prev => [
          ...prev,
          { id: nextId('u'), role: 'user', text: userText },
        ])
      }
      const payload: AssistantTurnRequest = {
        ...buildContext(),
        thread: buildThread(),
        conversation_id: conversationId,
        ...partial,
      }
      setBusy(true)
      setVoiceError(null)
      if (
        !options.bypassVoiceSocket &&
        mode === 'voice' &&
        socketRef.current?.isOpen()
      ) {
        // Result arrives asynchronously via the socket onResult handler.
        socketRef.current.send(payload as Record<string, unknown>)
        return
      }
      // Text mode, or a voice socket that is not OPEN (failed/closed/never
      // upgraded): fall back to the HTTP turn so `busy` is always cleared in
      // `finally` and the orb can never spin forever waiting on a dropped frame.
      try {
        const result = await runAssistantTurn(payload)
        if (result.conversation_id) setConversationId(result.conversation_id)
        appendResult(result)
        speak(result, {
          force: options.forceSpeak,
          prefix: options.speakPrefix,
        })
      } catch (err) {
        const timedOut = err instanceof AssistantTurnTimeoutError
        appendResult({
          blocks: [
            {
              kind: 'prose',
              speak: '',
              text: timedOut
                ? 'Wulo is taking too long. Try again in a moment.'
                : 'Offline for the moment. Try again when you have a connection.',
              citations: [],
            },
          ],
          session_complete: false,
        })
      } finally {
        setBusy(false)
      }
    },
    [appendResult, buildContext, buildThread, busy, conversationId, mode, speak]
  )

  const send = useCallback(
    (event?: FormEvent) => {
      if (event) event.preventDefault()
      const question = draft.trim()
      if (!question || busy) return
      setDraft('')
      void dispatchTurn({ question }, question)
    },
    [busy, dispatchTurn, draft]
  )

  const handleMcqAnswer = useCallback(
    (optionId: string) => {
      const card = lastCard()
      if (!card) return
      void dispatchTurn({
        last_card_id: card.id,
        last_kind: card.kind,
        answer_option_id: optionId,
      })
    },
    [dispatchTurn, lastCard]
  )

  const handleAdvance = useCallback(() => {
    const card = lastCard()
    void dispatchTurn({
      last_card_id: card?.id,
      last_kind: card?.kind,
      advance: true,
    })
  }, [dispatchTurn, lastCard])

  const handleFinish = useCallback(() => {
    setSessionComplete(false)
  }, [])

  const handleConfirm = useCallback(
    (block: AssistantConfirmationBlock) => {
      void dispatchTurn(
        { intent: block.action ?? 'practice', ...(block.params ?? {}) },
        block.confirm_label ?? 'Yes'
      )
    },
    [dispatchTurn]
  )

  const handleDismiss = useCallback((_block: AssistantConfirmationBlock) => {
    /* The learner declined — nothing to send; the prompt simply stands. */
  }, [])

  // --- Voice transport lifecycle -------------------------------------------

  const closeSocket = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setVoiceError('Voice input is not supported in this browser.')
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'en-GB'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = event => {
      const said = event.results?.[0]?.[0]?.transcript?.trim()
      if (said) void dispatchTurn({ question: said }, said)
    }
    recognition.onerror = event => {
      const code = event?.error ?? 'unknown'
      // Surface the real reason so failures are diagnosable instead of a single
      // catch-all "Could not hear that". `no-speech`/`aborted` are benign (the
      // learner simply did not speak, or tapped to stop) — reset quietly.
      if (code === 'no-speech' || code === 'aborted') {
        setListening(false)
        return
      }
      console.warn('[AskPathfinder] speech recognition error:', code)
      setVoiceError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone blocked. Allow mic access for this site, then tap again.'
          : code === 'audio-capture'
            ? 'No microphone found. Check your mic and try again.'
            : code === 'network'
              ? 'Speech service unreachable. Check your connection and try again.'
              : 'Could not hear that. Try again.'
      )
      setListening(false)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    setVoiceError(null)
    recognition.start()
  }, [dispatchTurn])

  const enterVoiceMode = useCallback(() => {
    setMode('voice')
    setVoiceError(null)
    // VoiceLive streams full-duplex audio over `/ws/voice?scope=learner_ask`
    // (handled by useAskPathfinderVoice); the Web Speech JSON socket is only the
    // fallback transport when the flag is off or the browser lacks the SDK.
    if (voiceLiveEnabled) return
    if (!socketRef.current) {
      socketRef.current = openLearnerVoiceSocket(
        {
          onResult: result => {
            appendResult(result)
            speak(result)
            setBusy(false)
          },
          onError: message => {
            setVoiceError(
              message === 'child_access_required'
                ? 'You can only talk about your own progress.'
                : 'Voice connection hiccup — retrying as you speak.'
            )
            setBusy(false)
          },
          onClose: () => setBusy(false),
        },
        { userId: learner.userId }
      )
    }
  }, [appendResult, learner.userId, speak, voiceLiveEnabled])

  const enterTextMode = useCallback(() => {
    setMode('text')
    setVoiceOpeningPrompt(undefined)
    stopListening()
    closeSocket()
  }, [closeSocket, stopListening])

  const closeSurface = useCallback(() => {
    // A drawer dismissed mid voice conversation powers the home voice entry
    // card's "Resume session" variant.
    if (mode === 'voice' && transcriptRef.current.length > 0) {
      askSurface?.setVoiceSessionDismissed(true)
    }
    setOpen(false)
    setMode('text')
    setVoiceOpeningPrompt(undefined)
    stopListening()
    closeSocket()
    // Reopening remounts the whole transcript; nothing in it is "fresh" then.
    liveIdsRef.current.clear()
    ttsStop()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [askSurface, closeSocket, mode, stopListening, ttsStop])

  // Programmatic opens from home-surface affordances (intent chips, the voice
  // entry card). Each request carries a fresh nonce; the ref de-dupes so a
  // re-render never re-fires an already-handled request.
  const askOpenRequest = askSurface?.openRequest ?? null
  const setVoiceSessionDismissed = askSurface?.setVoiceSessionDismissed
  const lastOpenNonceRef = useRef(0)
  useEffect(() => {
    if (!askOpenRequest || askOpenRequest.nonce === lastOpenNonceRef.current) {
      return
    }
    lastOpenNonceRef.current = askOpenRequest.nonce
    const intent = askOpenRequest.intent
    const opensStudy = intent?.kind === 'study'
    const opensVoice = askOpenRequest.mode === 'voice'
    setOpen(true)
    setVoiceSessionDismissed?.(false)
    setVoiceOpeningPrompt(opensStudy && opensVoice ? null : undefined)
    if (askOpenRequest.mode === 'voice') enterVoiceMode()
    else enterTextMode()
    // A study intent seeds a practice walk on open, so the surface returns a
    // tutor card and morphs into its focused tutor presentation — the unified
    // replacement for the standalone tutor entry point.
    if (intent?.kind === 'study') {
      // Open straight into the focused tutor view (the thinking indicator holds
      // it until the first card lands), clearing any earlier ask override.
      setPresentationOverride('tutor')
      const label = intent.skillLabel?.trim()
      const labelSentence = label ? sentenceLabel(label) : ''
      const requestText = label
        ? `Let's continue from ${labelSentence}`
        : "Let's start a practice session."
      const spokenIntro = opensVoice
        ? label
          ? `Welcome back. Let's continue from ${labelSentence}`
          : "Welcome back. Let's continue your practice."
        : undefined
      void dispatchTurn(
        {
          intent: 'practice',
          skill_id: intent.skillId ?? null,
          skill_strict: Boolean(intent.skillId),
        },
        requestText,
        {
          forceSpeak: opensVoice,
          speakPrefix: spokenIntro,
          bypassVoiceSocket: true,
        }
      )
    } else {
      // A plain open (Ask / talk-it-through) follows the content.
      setPresentationOverride(null)
    }
  }, [
    askOpenRequest,
    dispatchTurn,
    enterTextMode,
    enterVoiceMode,
    setVoiceSessionDismissed,
  ])

  // Start a fresh thread: clear the live transcript and its saved copy. The
  // save effect mirrors the empty state (which removes the storage key). A new
  // backend thread is minted on the next persisted turn.
  const startNewConversation = useCallback(() => {
    liveIdsRef.current.clear()
    setTranscript([])
    setSessionComplete(false)
    setDraft('')
    setVoiceError(null)
    setConversationId(null)
    setHistoryOpen(false)
    setPresentationOverride(null)
    ttsStop()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [ttsStop])

  // --- Thread history (Option B) -------------------------------------------

  // Open the history panel and refresh the list of saved threads for this
  // learner. Failures are swallowed to an empty list — history is additive and
  // must never block the live conversation.
  const openHistory = useCallback(async () => {
    setHistoryOpen(true)
    if (!childId) {
      setConversations([])
      return
    }
    setHistoryLoading(true)
    try {
      setConversations(await listAskConversations(childId))
    } catch {
      setConversations([])
    } finally {
      setHistoryLoading(false)
    }
  }, [childId])

  // Resume a saved thread: load its messages, replace the live transcript, and
  // adopt its id so the next turn extends it.
  const resumeConversation = useCallback(
    async (id: string) => {
      if (!childId) return
      setHistoryLoading(true)
      try {
        const { messages } = await getAskConversation(id, childId)
        liveIdsRef.current.clear()
        setTranscript(messagesToTranscript(messages))
        setConversationId(id)
        setSessionComplete(false)
        setHistoryOpen(false)
        if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
      } catch {
        setVoiceError('Could not open that conversation. Try again.')
      } finally {
        setHistoryLoading(false)
      }
    },
    [childId]
  )

  // Soft-delete a saved thread. If it is the one on screen, start fresh.
  const removeConversation = useCallback(
    async (id: string) => {
      if (!childId) return
      try {
        await deleteAskConversation(id, childId)
      } catch {
        /* Best-effort — leave the list as-is on failure. */
        return
      }
      setConversations(prev => prev.filter(item => item.id !== id))
      if (conversationId === id) {
        setTranscript([])
        setSessionComplete(false)
        setConversationId(null)
      }
    },
    [childId, conversationId]
  )

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      socketRef.current?.close()
    }
  }, [])

  const isVoice = mode === 'voice'

  // Presentation has two inputs. By default it is *derived* from content: when
  // the latest reply is a practice card the surface shows its focused "tutor"
  // view; prose/profile/plan replies show the conversational "ask" view. The
  // learner can also *override* this with the in-surface toggle button to jump
  // between the two full-screen views and back. Voice vs text (`mode`) is
  // orthogonal — either presentation can be spoken or typed.
  const unifiedEnabled = featureFlags.pathfinder_unified_assistant_enabled
  const latestAssistantBlock = useMemo<AssistantBlock | null>(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const item = transcript[i]
      if (item.role === 'assistant') return item.block
    }
    return null
  }, [transcript])
  // The most recent *card* (not just the most recent block): the tutor view
  // pins to this so "Back to practice" returns to the last exercise even after
  // the learner digs deeper into prose.
  const latestCardBlock = useMemo<AssistantBlock | null>(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const item = transcript[i]
      if (item.role === 'assistant' && CARD_KINDS.has(item.block.kind)) {
        return item.block
      }
    }
    return null
  }, [transcript])
  const derivedPresentation: 'tutor' | 'ask' =
    latestAssistantBlock !== null && CARD_KINDS.has(latestAssistantBlock.kind)
      ? 'tutor'
      : 'ask'
  const presentation: 'tutor' | 'ask' = unifiedEnabled
    ? (presentationOverride ?? derivedPresentation)
    : 'ask'
  // The focused tutor stage needs a card to show. While a practice turn is in
  // flight we still hold the tutor view (showing the thinking indicator) so the
  // surface doesn't flicker back to the ask layout between taps.
  const isTutor =
    unifiedEnabled &&
    presentation === 'tutor' &&
    (latestCardBlock !== null || busy)
  // The toggle can always reach the ask view; it can only reach the tutor view
  // once there is a card to return to.
  const canSwitchToTutor = latestCardBlock !== null
  const togglePresentation = useCallback(() => {
    setPresentationOverride(prev => {
      const current = prev ?? derivedPresentation
      return current === 'tutor' ? 'ask' : 'tutor'
    })
  }, [derivedPresentation])
  const micActive = voiceLiveEnabled ? liveRecording : listening
  const micDisabled = voiceLiveEnabled ? false : !speechSupported || busy
  // One mic, living in the composer. Tapping it engages live voice in place —
  // for VoiceLive it opens/closes the full-duplex session (the hook auto-opens
  // the mic on activation); for the Web Speech fallback it opens the JSON
  // socket and starts dictation. The transcript, cards and composer all stay
  // put — voice is an input, not a separate screen.
  const handleMicToggle = useCallback(() => {
    if (voiceLiveEnabled) {
      if (isVoice) enterTextMode()
      else {
        setVoiceOpeningPrompt(undefined)
        enterVoiceMode()
      }
      return
    }
    if (listening) stopListening()
    else {
      enterVoiceMode()
      startListening()
    }
  }, [
    enterTextMode,
    enterVoiceMode,
    isVoice,
    listening,
    startListening,
    stopListening,
    voiceLiveEnabled,
  ])
  // The orb narrates the same staged pipeline as the text-mode indicator
  // while Wulo works on a voice answer, instead of a static "Thinking…".
  const voiceThinking = isVoice
    ? voiceLiveEnabled
      ? liveVoiceState === 'thinking'
      : busy && !listening
    : false
  const voiceThinkingLabel = useThinkingStage(voiceThinking)
  const voiceHint = voiceLiveEnabled
    ? liveVoiceState === 'speaking'
      ? 'Wulo Academy is speaking…'
      : liveVoiceState === 'thinking'
        ? voiceThinkingLabel
        : liveVoiceState === 'connecting'
          ? 'Connecting…'
          : micActive
            ? 'Listening… tap End to stop.'
            : 'Tap to talk.'
    : !speechSupported
      ? 'Voice input is not supported here — switch to the keyboard to type.'
      : listening
        ? 'Listening… tap End to stop.'
        : busy
          ? voiceThinkingLabel
          : 'Tap to talk.'

  return (
    <>
      {!open && !hideLauncher && (
        <button
          type="button"
          className={styles.fab}
          onClick={() => {
            setOpen(true)
            askSurface?.setVoiceSessionDismissed(false)
          }}
          aria-label="Open Ask Wulo Academy"
          data-testid="ask-pathfinder-fab"
        >
          <SparklesIcon className={styles.fabGlyph} aria-hidden="true" />
        </button>
      )}
      {open && (
        <aside
          className={mergeClasses(
            styles.drawer,
            isVoice && styles.drawerVoice,
            unifiedEnabled && styles.drawerTutor
          )}
          aria-label="Ask Wulo Academy"
          data-testid="ask-pathfinder-drawer"
          data-mode={mode}
          data-presentation={presentation}
        >
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.title}>
                {unifiedEnabled
                  ? isTutor
                    ? 'Wulo Tutor'
                    : 'Ask Wulo'
                  : 'Ask Wulo Academy'}
              </span>
              {unifiedEnabled && (
                <button
                  type="button"
                  className={styles.switchBtn}
                  onClick={togglePresentation}
                  disabled={!isTutor && !canSwitchToTutor}
                  aria-label={
                    isTutor
                      ? 'Open Ask Wulo to dig deeper'
                      : 'Back to practice'
                  }
                  title={
                    isTutor
                      ? 'Open Ask Wulo to dig deeper'
                      : 'Back to practice'
                  }
                  data-testid="ask-pathfinder-presentation-toggle"
                >
                  {isTutor ? (
                    <ChatBubbleLeftRightIcon
                      className={styles.switchGlyph}
                      aria-hidden="true"
                    />
                  ) : (
                    <AcademicCapIcon
                      className={styles.switchGlyph}
                      aria-hidden="true"
                    />
                  )}
                  <span className={styles.switchLabel}>
                    {isTutor ? 'Dig deeper' : 'Practice'}
                  </span>
                </button>
              )}
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={mergeClasses(
                  styles.closeBtn,
                  historyOpen && styles.closeBtnActive
                )}
                onClick={() => {
                  if (historyOpen) setHistoryOpen(false)
                  else void openHistory()
                }}
                aria-pressed={historyOpen}
                aria-label="Conversation history"
                title="Conversation history"
                data-testid="ask-pathfinder-history"
              >
                <ClockIcon className={styles.closeGlyph} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={startNewConversation}
                disabled={busy || transcript.length === 0}
                aria-label="Start a new conversation"
                title="New conversation"
                data-testid="ask-pathfinder-new"
              >
                <PlusIcon className={styles.closeGlyph} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={closeSurface}
                aria-label="Close Ask Wulo Academy"
              >
                <XMarkIcon className={styles.closeGlyph} aria-hidden="true" />
              </button>
            </div>
          </header>

          {historyOpen && (
            <div
              className={styles.historyPanel}
              data-testid="ask-pathfinder-history-panel"
            >
              {historyLoading ? (
                <span className={styles.historyEmpty}>Loading…</span>
              ) : conversations.length === 0 ? (
                <span className={styles.historyEmpty}>
                  No saved conversations yet.
                </span>
              ) : (
                <ul className={styles.historyList}>
                  {conversations.map(item => (
                    <li key={item.id} className={styles.historyItem}>
                      <button
                        type="button"
                        className={mergeClasses(
                          styles.historyOpenBtn,
                          conversationId === item.id && styles.historyItemActive
                        )}
                        onClick={() => void resumeConversation(item.id)}
                        data-testid="ask-pathfinder-history-item"
                      >
                        <span className={styles.historyTitle}>
                          {item.title || 'Conversation'}
                        </span>
                        <span className={styles.historyDate}>
                          {formatHistoryDate(item.updated_at)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.historyDeleteBtn}
                        onClick={() => void removeConversation(item.id)}
                        aria-label={`Delete ${item.title || 'conversation'}`}
                        title="Delete conversation"
                        data-testid="ask-pathfinder-history-delete"
                      >
                        <TrashIcon
                          className={styles.historyDeleteGlyph}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div
            className={mergeClasses(
              styles.transcript,
              isTutor && styles.transcriptTutor
            )}
            data-testid="ask-pathfinder-transcript"
            ref={transcriptScrollRef}
          >
            {isTutor ? (
              <div className={styles.tutorStage} data-testid="ask-pathfinder-tutor-stage">
                {latestCardBlock ? (
                  <AssistantBlockRenderer
                    block={latestCardBlock}
                    disabled={busy}
                    sessionComplete={sessionComplete}
                    animate
                    onMcqAnswer={handleMcqAnswer}
                    onAdvance={handleAdvance}
                    onFinish={handleFinish}
                    onConfirm={handleConfirm}
                    onDismiss={handleDismiss}
                  />
                ) : null}
                {busy && <ThinkingIndicator />}
              </div>
            ) : (
              <>
                {transcript.length === 0 && (
                  <span className={styles.empty}>
                    {isVoice
                      ? 'Tap the mic and talk. Ask about your plan, start an exercise, or check your progress.'
                      : "Ask about today's plan, a wrong answer, or start an exercise. Grounded answers, no outcome guarantees."}
                  </span>
                )}
                {transcript.map(item =>
                  item.role === 'user' ? (
                    <div key={item.id} className={styles.msgUser}>
                      {item.text}
                    </div>
                  ) : (
                    <AssistantBlockRenderer
                      key={item.id}
                      block={item.block}
                      disabled={busy}
                      sessionComplete={sessionComplete}
                      animate={liveIdsRef.current.has(item.id)}
                      onMcqAnswer={handleMcqAnswer}
                      onAdvance={handleAdvance}
                      onFinish={handleFinish}
                      onConfirm={handleConfirm}
                      onDismiss={handleDismiss}
                    />
                  )
                )}
                {busy && <ThinkingIndicator />}
              </>
            )}
          </div>

          {isVoice && (voiceError || voiceHint) && (
            <div
              className={styles.voiceStatus}
              data-testid="ask-pathfinder-voice-status"
            >
              {voiceError ? (
                <span className={styles.voiceError}>{voiceError}</span>
              ) : voiceThinking ? (
                <span
                  className={styles.voiceThinkingPill}
                  aria-live="polite"
                  aria-label="Wulo Academy is thinking"
                  data-testid="ask-pathfinder-voice-thinking"
                >
                  <span className={styles.voiceThinkingDots} aria-hidden="true">
                    <span className={styles.voiceThinkingDot} />
                    <span
                      className={styles.voiceThinkingDot}
                      style={{ animationDelay: '0.18s' }}
                    />
                    <span
                      className={styles.voiceThinkingDot}
                      style={{ animationDelay: '0.36s' }}
                    />
                  </span>
                  {voiceThinkingLabel}
                </span>
              ) : (
                <span className={styles.voiceHint}>{voiceHint}</span>
              )}
            </div>
          )}
          <form className={styles.composer} onSubmit={send}>
            <textarea
              className={styles.textarea}
              aria-label="Ask Wulo Academy a question"
              placeholder="Ask Wulo Academy…"
              value={draft}
              onChange={e => setDraft(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              data-testid="ask-pathfinder-input"
            />
            {isVoice ? (
              <button
                type="button"
                className={styles.endBtn}
                onClick={enterTextMode}
                aria-label="End voice session"
                title="End voice session"
                data-testid="ask-pathfinder-end"
              >
                <StopIcon className={styles.endGlyph} aria-hidden="true" />
                <span>End</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={handleMicToggle}
                disabled={micDisabled}
                aria-label="Talk to Wulo Academy"
                title="Talk to Wulo Academy"
                data-testid="ask-pathfinder-mic"
              >
                <VoiceWaveIcon className={styles.iconGlyph} />
              </button>
            )}
            <button
              type="submit"
              className={styles.iconBtn}
              disabled={busy || draft.trim().length === 0}
              aria-label="Send question"
              data-testid="ask-pathfinder-send"
            >
              <PaperAirplaneIcon
                className={styles.iconGlyph}
                aria-hidden="true"
              />
            </button>
          </form>
        </aside>
      )}
    </>
  )
}

export default AskPathfinder
