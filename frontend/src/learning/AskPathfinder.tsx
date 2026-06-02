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
 *   with speech-to-text and block.speak text-to-speech handled at the edge via
 *   the Web Speech API when the browser supports it.
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
  ChatBubbleLeftRightIcon,
  MicrophoneIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import {
  openLearnerVoiceSocket,
  runAssistantTurn,
  type AssistantBlock,
  type AssistantConfirmationBlock,
  type AssistantThreadTurn,
  type AssistantTurnRequest,
  type AssistantTurnResult,
  type LearnerVoiceSocket,
} from './api'
import { AssistantBlockRenderer } from './components/AssistantBlockRenderer'
import { useLearnerContext } from './contexts/LearnerContext'
import { useAskPathfinderVoice } from './hooks/useAskPathfinderVoice'

type Mode = 'text' | 'voice'

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
    bottom: '168px',
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
      'transform .18s cubic-bezier(0.2, 0.8, 0.2, 1), filter .15s ease',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
    },
    ':active': { transform: 'scale(0.92)' },
    '@media (max-width: 1000px)': {
      bottom: '216px',
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
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
    background: '#0d0d0f',
    color: '#f4f4f6',
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
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  title: { fontWeight: 600, fontSize: '15px' },
  modeToggle: {
    display: 'flex',
    gap: '2px',
    padding: '2px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.05)',
  },
  modeBtn: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: '#9a9aa2',
    cursor: 'pointer',
    padding: '5px 8px',
    borderRadius: '999px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { color: '#f4f4f6' },
  },
  modeBtnActive: {
    background: 'linear-gradient(160deg, #4a4a4d 0%, #0a0a0a 100%)',
    color: '#ffffff',
  },
  modeGlyph: { width: '16px', height: '16px' },
  closeBtn: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: '#cfcfd4',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'rgba(255,255,255,0.06)' },
  },
  closeGlyph: { width: '18px', height: '18px' },
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
    background: '#2a2a2e',
  },
  empty: { color: '#8a8a91', fontStyle: 'italic' },
  voiceStage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px 16px',
  },
  orb: {
    width: '92px',
    height: '92px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    background:
      'radial-gradient(circle at 35% 30%, rgba(155,212,255,0.6), rgba(20,20,24,0.9))',
    boxShadow: '0 0 48px rgba(155,212,255,0.25)',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    transition: 'transform .2s ease, box-shadow .2s ease',
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
  orbActive: {
    transform: 'scale(1.08)',
    boxShadow: '0 0 72px rgba(155,212,255,0.5)',
  },
  orbGlyph: { width: '34px', height: '34px' },
  voiceHint: { color: '#9a9aa2', fontSize: '13px', textAlign: 'center' },
  voiceError: { color: '#ff9d9d', fontSize: '13px', textAlign: 'center' },
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    padding: '10px 12px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  textarea: {
    flex: 1,
    background: '#16161a',
    color: '#f4f4f6',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '14px',
    resize: 'none',
    minHeight: '36px',
    maxHeight: '120px',
    outline: 'none',
    ':focus': {
      borderTopColor: 'rgba(255,255,255,0.18)',
      borderRightColor: 'rgba(255,255,255,0.18)',
      borderBottomColor: 'rgba(255,255,255,0.18)',
      borderLeftColor: 'rgba(255,255,255,0.18)',
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
    background: '#23232a',
    color: '#f4f4f6',
    ':hover:not(:disabled)': { background: '#2c2c34' },
    ':disabled': { opacity: 0.45, cursor: 'not-allowed' },
  },
  iconGlyph: { width: '18px', height: '18px' },
})

export function AskPathfinder({
  voiceLiveEnabled = false,
}: { voiceLiveEnabled?: boolean } = {}) {
  const styles = useStyles()
  const learner = useLearnerContext()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('text')
  const [draft, setDraft] = useState('')
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [busy, setBusy] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const socketRef = useRef<LearnerVoiceSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef<TranscriptItem[]>([])
  transcriptRef.current = transcript
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest reply in view: as soon as a turn is appended (or the
  // assistant starts thinking) pin the transcript to the bottom so the learner
  // never has to drag the scrollbar to read the response.
  const turnCount = transcript.length
  useEffect(() => {
    void turnCount
    void busy
    const node = transcriptScrollRef.current
    if (!node) return
    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    } else {
      node.scrollTop = node.scrollHeight
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
      daily_plan: learner.dailyPlan.map(d => ({ id: d.id, title: d.title })),
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

  const speak = useCallback(
    (result: AssistantTurnResult) => {
      if (mode !== 'voice' || typeof window === 'undefined') return
      const synth = window.speechSynthesis
      if (!synth) return
      const line = result.blocks
        .map(block => ('speak' in block ? block.speak : ''))
        .filter(Boolean)
        .join(' ')
      if (!line) return
      synth.speak(new SpeechSynthesisUtterance(line))
    },
    [mode]
  )

  const appendResult = useCallback((result: AssistantTurnResult) => {
    setTranscript(prev => [
      ...prev,
      ...result.blocks.map(block => ({
        id: nextId('a'),
        role: 'assistant' as const,
        block,
      })),
    ])
    setSessionComplete(result.session_complete)
  }, [])

  // VoiceLive emits one grounded, safeguarded block at a time over the realtime
  // socket; append it and clear the busy spinner. The neural voice is heard via
  // the audio player inside the hook, so no edge TTS here.
  const appendVoiceBlock = useCallback(
    (block: AssistantBlock, complete: boolean) => {
      setTranscript(prev => [
        ...prev,
        { id: nextId('a'), role: 'assistant' as const, block },
      ])
      setSessionComplete(complete)
      setBusy(false)
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
    toggleRecording: liveToggleRecording,
  } = useAskPathfinderVoice({
    active: mode === 'voice' && voiceLiveEnabled,
    childId: learner.userId ?? '',
    subject: learner.learnerSetup?.subject,
    classYear: learner.learnerSetup?.yearGroup,
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
    async (partial: Partial<AssistantTurnRequest>, userText?: string) => {
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
        ...partial,
      }
      setBusy(true)
      setVoiceError(null)
      if (mode === 'voice' && socketRef.current) {
        // Result arrives asynchronously via the socket onResult handler.
        socketRef.current.send(payload as Record<string, unknown>)
        return
      }
      try {
        const result = await runAssistantTurn(payload)
        appendResult(result)
        speak(result)
      } catch {
        appendResult({
          blocks: [
            {
              kind: 'prose',
              speak: '',
              text: 'Offline for the moment. Try again when you have a connection.',
              citations: [],
            },
          ],
          session_complete: false,
        })
      } finally {
        setBusy(false)
      }
    },
    [appendResult, buildContext, buildThread, busy, mode, speak]
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
    stopListening()
    closeSocket()
  }, [closeSocket, stopListening])

  const closeSurface = useCallback(() => {
    setOpen(false)
    stopListening()
    closeSocket()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [closeSocket, stopListening])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      socketRef.current?.close()
    }
  }, [])

  const isVoice = mode === 'voice'

  // Voice mic is driven either by VoiceLive (full-duplex realtime) or the Web
  // Speech fallback, depending on the server feature flag.
  const micActive = voiceLiveEnabled ? liveRecording : listening
  const micDisabled = voiceLiveEnabled ? false : !speechSupported || busy
  const micOnClick = voiceLiveEnabled
    ? () => {
        void liveToggleRecording()
      }
    : listening
      ? stopListening
      : startListening
  const voiceHint = voiceLiveEnabled
    ? liveVoiceState === 'speaking'
      ? 'Pathfinder is speaking…'
      : liveVoiceState === 'thinking'
        ? 'Thinking…'
        : liveVoiceState === 'connecting'
          ? 'Connecting…'
          : micActive
            ? 'Listening… tap to mute.'
            : 'Tap to talk.'
    : !speechSupported
      ? 'Voice input is not supported here — switch to the keyboard to type.'
      : listening
        ? 'Listening… tap to stop.'
        : busy
          ? 'Thinking…'
          : 'Tap to talk.'

  return (
    <>
      {!open && (
        <button
          type="button"
          className={styles.fab}
          onClick={() => setOpen(true)}
          aria-label="Open Ask Pathfinder"
          data-testid="ask-pathfinder-fab"
        >
          <ChatBubbleLeftRightIcon
            className={styles.fabGlyph}
            aria-hidden="true"
          />
        </button>
      )}
      {open && (
        <aside
          className={mergeClasses(styles.drawer, isVoice && styles.drawerVoice)}
          aria-label="Ask Pathfinder"
          data-testid="ask-pathfinder-drawer"
          data-mode={mode}
        >
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.title}>Ask Pathfinder</span>
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.modeBtn,
                    !isVoice && styles.modeBtnActive
                  )}
                  onClick={enterTextMode}
                  aria-pressed={!isVoice}
                  aria-label="Type your question"
                  data-testid="ask-pathfinder-mode-text"
                >
                  <PencilSquareIcon
                    className={styles.modeGlyph}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.modeBtn,
                    isVoice && styles.modeBtnActive
                  )}
                  onClick={enterVoiceMode}
                  aria-pressed={isVoice}
                  aria-label="Talk to Pathfinder"
                  data-testid="ask-pathfinder-mode-voice"
                >
                  <MicrophoneIcon
                    className={styles.modeGlyph}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={closeSurface}
              aria-label="Close Ask Pathfinder"
            >
              <XMarkIcon className={styles.closeGlyph} aria-hidden="true" />
            </button>
          </header>

          <div
            className={styles.transcript}
            data-testid="ask-pathfinder-transcript"
            ref={transcriptScrollRef}
          >
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
                  onMcqAnswer={handleMcqAnswer}
                  onAdvance={handleAdvance}
                  onFinish={handleFinish}
                  onConfirm={handleConfirm}
                  onDismiss={handleDismiss}
                />
              )
            )}
          </div>

          {isVoice ? (
            <div className={styles.voiceStage}>
              <button
                type="button"
                className={mergeClasses(
                  styles.orb,
                  micActive && styles.orbActive
                )}
                onClick={micOnClick}
                disabled={micDisabled}
                aria-label={micActive ? 'Stop listening' : 'Start talking'}
                data-testid="ask-pathfinder-mic"
              >
                {micActive ? (
                  <StopIcon className={styles.orbGlyph} aria-hidden="true" />
                ) : (
                  <MicrophoneIcon
                    className={styles.orbGlyph}
                    aria-hidden="true"
                  />
                )}
              </button>
              {voiceError ? (
                <span className={styles.voiceError}>{voiceError}</span>
              ) : (
                <span className={styles.voiceHint}>{voiceHint}</span>
              )}
            </div>
          ) : (
            <form className={styles.composer} onSubmit={send}>
              <textarea
                className={styles.textarea}
                aria-label="Ask Pathfinder a question"
                placeholder="Ask Pathfinder…"
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
          )}
        </aside>
      )}
    </>
  )
}

export default AskPathfinder
