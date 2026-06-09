/**
 * Goal intake — a voice-narrated, one-question-at-a-time orb experience.
 *
 * Premium, ChatGPT-voice-style flow with progressive disclosure (Apple HIG
 * "Depth"): an animating orb anchors the screen, and the agent SPEAKS each
 * guided question (via {@link useTtsPlayer}) as its gen-UI option card animates
 * in. The learner answers one question at a time — subject, exam, timeframe,
 * then an optional note — and each answer animates the next question in while it
 * is narrated. After the answers are collected the orb shows a brief "finding
 * your start" state, then reveals the recommendation list, which the learner can
 * either start answering instantly or save to Today's path to learn later.
 *
 * Reuses the shared {@link AssistantBlockRenderer} for the result blocks and the
 * deterministic {@link recommendFromGoal} brain (same soft-bias planner as the
 * `learner_goals` voice agent), so the spoken/stepped UI and any other surface
 * yield identical recommendations.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { makeStyles, mergeClasses } from '@fluentui/react-components'
import {
  ArrowsPointingInIcon,
  PlayIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import {
  recommendFromGoal,
  type AssistantBlock,
  type GoalTimeframe,
} from './api'
import { AssistantBlockRenderer } from './components/AssistantBlockRenderer'
import { useTtsPlayer } from './hooks/useTtsPlayer'

export interface GoalIntakeScreenProps {
  studentId: string
  /** Begin answering the recommended plan now — defaults to {@link onDone}.
   * Receives the first recommended skill id (when present) so the caller can
   * land the learner on the exact recommended skill. */
  onStart?: (skillId?: string) => void
  /** Stash the plan in Today's path to learn later — defaults to {@link onDone}. */
  onSaveForLater?: () => void
  /** Called when the learner finishes, skips, or closes — typically /home. */
  onDone: () => void
}

type Phase = 'intro' | 'step' | 'generating' | 'results'
type QuestionKey = 'subject' | 'exam' | 'timeframe'

interface OptionDef {
  label: string
  /** Stored value; `null` is a skip sentinel (no biasing signal). */
  value: string | null
}

interface QuestionDef {
  key: QuestionKey
  prompt: string
  /** Spoken form, narrated as the question animates in. */
  say: string
  options: OptionDef[]
}

const QUESTIONS: QuestionDef[] = [
  {
    key: 'subject',
    prompt: 'What do you want to focus on first?',
    say: "Great, let's set your goal. First — what do you want to focus on? Maths, English, or something else?",
    options: [
      { label: 'Maths', value: 'Maths' },
      { label: 'English', value: 'English' },
      { label: 'Something else', value: null },
    ],
  },
  {
    key: 'exam',
    prompt: "Any exam you're working toward?",
    say: 'Are you working toward an exam? WAEC, NECO, JAMB, or none yet?',
    options: [
      { label: 'WAEC', value: 'WAEC' },
      { label: 'NECO', value: 'NECO' },
      { label: 'JAMB', value: 'JAMB' },
      { label: 'None yet', value: null },
    ],
  },
  {
    key: 'timeframe',
    prompt: 'When do you want to be ready?',
    say: 'And when do you want to be ready? This term, this year, or no fixed deadline?',
    options: [
      { label: 'This term', value: 'this_term' },
      { label: 'This year', value: 'this_year' },
      { label: 'No deadline', value: 'no_deadline' },
    ],
  },
]

const NOTE_INDEX = QUESTIONS.length // the optional note is the step after Q3
const TOTAL_STEPS = QUESTIONS.length + 1
const STEP_DOT_IDS = ['subject', 'exam', 'timeframe', 'note'] as const

const NOTE_SAY =
  "Last one — anything else you'd like me to know? You can skip this."
const GENERATING_SAY = 'Great. Let me line up the best place for you to start.'

let _blockCounter = 0
function nextBlockId(): string {
  _blockCounter += 1
  return `goal-block-${Date.now().toString(36)}-${_blockCounter}`
}

type KeyedBlock = { id: string; block: AssistantBlock }

const useStyles = makeStyles({
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 120,
    background: 'var(--scrim-bg-goal)',
    color: 'var(--scrim-fg)',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    overflow: 'hidden',
    transformOrigin: 'bottom right',
    transition: 'transform 280ms ease, opacity 280ms ease',
  },
  scrimMinimizing: {
    transform: 'scale(0.16) translate(42%, 46%)',
    opacity: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
  },
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.9rem',
    fontWeight: 800,
  },
  brandDot: {
    width: '9px',
    height: '9px',
    borderRadius: '999px',
    backgroundColor: 'var(--scrim-fill)',
    boxShadow: 'var(--scrim-brand-dot-glow)',
  },
  progress: { display: 'inline-flex', gap: '7px', alignItems: 'center' },
  dot: {
    width: '7px',
    height: '7px',
    borderRadius: '999px',
    background: 'var(--scrim-line-strong)',
    transition: 'background 220ms ease, transform 220ms ease',
  },
  dotActive: { background: 'var(--scrim-fill)', transform: 'scale(1.25)' },
  dotDone: { background: 'var(--scrim-fg-soft)' },
  iconButton: {
    width: '40px',
    height: '40px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg-strong)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
  },
  icon: { width: '19px', height: '19px' },
  body: {
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'center',
    gap: '26px',
    padding: '20px 20px 8px',
    overflowY: 'auto',
  },
  orb: {
    width: 'min(176px, 42vw)',
    aspectRatio: '1',
    borderRadius: '999px',
    background:
      'radial-gradient(circle at 32% 26%, #ffffff 0%, #d8d8dd 34%, #53535a 68%, #101012 100%)',
    boxShadow: 'var(--scrim-orb-glow)',
    flexShrink: 0,
  },
  orbBreathing: {
    animationName: {
      '0%, 100%': { transform: 'scale(0.99)' },
      '50%': { transform: 'scale(1.03)' },
    },
    animationDuration: '2600ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  orbSpeaking: {
    animationName: {
      '0%, 100%': { transform: 'scale(0.98)' },
      '50%': { transform: 'scale(1.06)' },
    },
    animationDuration: '900ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    boxShadow: 'var(--scrim-orb-speaking-glow)',
  },
  orbThinking: {
    animationName: {
      '0%': { transform: 'rotate(0deg) scale(1.01)' },
      '100%': { transform: 'rotate(360deg) scale(1.01)' },
    },
    animationDuration: '2200ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
    background: 'var(--scrim-orb-thinking-bg)',
  },
  enter: {
    animationName: {
      from: { opacity: 0, transform: 'translateY(14px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    animationDuration: '420ms',
    animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    animationFillMode: 'both',
  },
  status: { display: 'grid', gap: '6px', textAlign: 'center' },
  stateTitle: { fontSize: '1.32rem', fontWeight: 800, letterSpacing: '-0.01em' },
  stateHint: { color: 'var(--scrim-fg-soft)', fontSize: '0.92rem' },
  question: { display: 'grid', gap: '14px', justifyItems: 'center', width: 'min(560px, 100%)' },
  questionText: {
    fontSize: '1.16rem',
    fontWeight: 700,
    textAlign: 'center',
    letterSpacing: '-0.01em',
  },
  options: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    justifyContent: 'center',
  },
  option: {
    padding: '14px 22px',
    borderRadius: '16px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    minHeight: '52px',
    animationName: {
      from: { opacity: 0, transform: 'translateY(12px) scale(0.98)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '460ms',
    animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    animationFillMode: 'both',
    transition: 'background 140ms ease, transform 140ms ease',
    ':hover': { background: 'var(--scrim-chip-hover)', transform: 'translateY(-1px)' },
  },
  noteCard: { display: 'grid', gap: '14px', width: 'min(560px, 100%)', justifyItems: 'center' },
  note: {
    width: '100%',
    minHeight: '64px',
    padding: '14px 16px',
    borderRadius: '16px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    fontSize: '0.98rem',
    fontFamily: 'inherit',
  },
  rowCenter: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' },
  resultsSheet: {
    width: 'min(620px, 100%)',
    borderRadius: '20px',
    background: 'var(--scrim-fill)',
    color: 'var(--scrim-on-fill)',
    padding: '20px',
    display: 'grid',
    gap: '14px',
    boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
    animationName: {
      from: { opacity: 0, transform: 'translateY(18px) scale(0.98)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '520ms',
    animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    animationFillMode: 'both',
  },
  resultActions: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  error: { color: '#b3261e', fontSize: '0.92rem' },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '16px 24px 28px',
  },
  primary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 24px',
    borderRadius: '999px',
    border: 'none',
    background: '#ffffff',
    color: '#101012',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 700,
  },
  primaryDark: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 24px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-mic-bg)',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 700,
    boxShadow: 'var(--scrim-mic-shadow)',
  },
  secondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 20px',
    borderRadius: '999px',
    border: '1px solid rgba(16,16,18,0.16)',
    background: 'transparent',
    color: '#101012',
    cursor: 'pointer',
    fontSize: '0.96rem',
    fontWeight: 600,
  },
  ghost: {
    padding: '12px 16px',
    borderRadius: '999px',
    border: 'none',
    background: 'transparent',
    color: 'var(--scrim-fg-soft)',
    cursor: 'pointer',
    fontSize: '0.92rem',
  },
  btnIcon: { width: '18px', height: '18px' },
})

export function GoalIntakeScreen({
  studentId,
  onStart,
  onSaveForLater,
  onDone,
}: GoalIntakeScreenProps): JSX.Element {
  const styles = useStyles()
  const [phase, setPhase] = useState<Phase>('intro')
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<
    Partial<Record<QuestionKey, string | null>>
  >({})
  const [note, setNote] = useState('')
  const [blocks, setBlocks] = useState<KeyedBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [minimizing, setMinimizing] = useState(false)
  const minimizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tts = useTtsPlayer()
  const speak = useCallback(
    (text: string) => {
      void tts.play(text)
    },
    [tts]
  )

  const submit = useCallback(
    async (finalNote: string) => {
      setPhase('generating')
      setError(null)
      speak(GENERATING_SAY)
      try {
        const result = await recommendFromGoal({
          student_id: studentId || undefined,
          subject: answers.subject ?? undefined,
          exam: answers.exam ?? undefined,
          target_date: (answers.timeframe as GoalTimeframe | null) ?? undefined,
          note: finalNote.trim() || undefined,
        })
        setBlocks(result.blocks.map(block => ({ id: nextBlockId(), block })))
        const prose = result.blocks.find(b => b.kind === 'prose') as
          | { speak?: string; text?: string }
          | undefined
        if (prose) speak(prose.speak || prose.text || '')
        setPhase('results')
      } catch {
        setError('Could not get recommendations just now. You can skip for now.')
        setPhase('results')
      }
    },
    [studentId, answers, speak]
  )

  const begin = useCallback(() => {
    // This tap is the user gesture that unlocks audio autoplay, so narrate Q1.
    setPhase('step')
    setStepIndex(0)
    speak(QUESTIONS[0].say)
  }, [speak])

  const answerQuestion = useCallback(
    (key: QuestionKey, value: string | null) => {
      setAnswers(prev => ({ ...prev, [key]: value }))
      const next = stepIndex + 1
      setStepIndex(next)
      if (next < QUESTIONS.length) speak(QUESTIONS[next].say)
      else speak(NOTE_SAY)
    },
    [stepIndex, speak]
  )

  const startNow = useCallback(() => {
    tts.stop()
    // Surface the first recommended skill (PlanBlock.steps[0].skill_id) so the
    // caller can force it as the opening practice card.
    const planBlock = blocks.find(b => b.block.kind === 'plan')
    const firstSkill =
      planBlock && planBlock.block.kind === 'plan'
        ? (planBlock.block.steps.find(s => s.skill_id)?.skill_id ?? undefined)
        : undefined
    if (onStart) onStart(firstSkill ?? undefined)
    else onDone()
  }, [tts, onStart, onDone, blocks])

  const saveForLater = useCallback(() => {
    tts.stop()
    setMinimizing(true)
    minimizeTimer.current = setTimeout(() => {
      ;(onSaveForLater ?? onDone)()
    }, 280)
  }, [tts, onSaveForLater, onDone])

  const close = useCallback(() => {
    tts.stop()
    if (minimizeTimer.current) clearTimeout(minimizeTimer.current)
    onDone()
  }, [tts, onDone])

  const hasResults = blocks.length > 0

  const statusTitle = useMemo(() => {
    if (phase === 'intro') return 'What are you aiming for?'
    if (phase === 'generating') return 'Finding your starting point…'
    if (phase === 'results')
      return hasResults ? 'Here’s where to start' : 'Let’s try that again'
    if (stepIndex >= NOTE_INDEX) return 'Almost done'
    return tts.playing ? 'Listening…' : 'Your turn'
  }, [phase, stepIndex, hasResults, tts.playing])

  const statusHint = useMemo(() => {
    if (phase === 'intro') return 'A one-minute chat to personalise your start.'
    if (phase === 'generating') return 'Lining up the best first steps for you.'
    if (phase === 'results')
      return hasResults
        ? 'Start now, or save it to Today’s path for later.'
        : 'Something went wrong reaching your plan.'
    if (stepIndex >= NOTE_INDEX) return 'Add a note, or skip — your choice.'
    return 'Tap your answer, or listen and pick when ready.'
  }, [phase, stepIndex, hasResults])

  const orbClass = mergeClasses(
    styles.orb,
    phase === 'generating'
      ? styles.orbThinking
      : tts.playing
        ? styles.orbSpeaking
        : styles.orbBreathing
  )

  const currentStepForDots =
    phase === 'results' || phase === 'generating' ? TOTAL_STEPS : stepIndex

  return (
    <div
      className={mergeClasses(styles.scrim, minimizing && styles.scrimMinimizing)}
      data-testid="goal-intake-fullscreen"
    >
      <div className={styles.header}>
        <span className={styles.brand}>
          <span className={styles.brandDot} />
          Wulo Academy
        </span>
        {phase === 'step' ? (
          <div className={styles.progress} aria-hidden>
            {STEP_DOT_IDS.map((id, i) => (
              <span
                key={id}
                className={mergeClasses(
                  styles.dot,
                  i === currentStepForDots && styles.dotActive,
                  i < currentStepForDots && styles.dotDone
                )}
              />
            ))}
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={close}
          aria-label="Close"
          data-testid="goal-close"
        >
          <XMarkIcon className={styles.icon} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={orbClass} />
        <div className={styles.status}>
          <div className={styles.stateTitle}>{statusTitle}</div>
          <div className={styles.stateHint}>{statusHint}</div>
        </div>

        {phase === 'intro' ? (
          <div className={styles.rowCenter}>
            <button
              type="button"
              className={styles.primary}
              onClick={begin}
              data-testid="goal-begin"
            >
              <SparklesIcon className={styles.btnIcon} />
              Let’s go
            </button>
            <button type="button" className={styles.ghost} onClick={close}>
              Skip for now
            </button>
          </div>
        ) : null}

        {phase === 'step' && stepIndex < QUESTIONS.length ? (
          <div className={styles.question} key={QUESTIONS[stepIndex].key}>
            <div className={styles.questionText}>
              {QUESTIONS[stepIndex].prompt}
            </div>
            <div className={styles.options}>
              {QUESTIONS[stepIndex].options.map((option, i) => (
                <button
                  key={option.label}
                  type="button"
                  className={styles.option}
                  style={{ animationDelay: `${120 + i * 90}ms` }}
                  onClick={() =>
                    answerQuestion(QUESTIONS[stepIndex].key, option.value)
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {phase === 'step' && stepIndex >= NOTE_INDEX ? (
          <div className={mergeClasses(styles.noteCard, styles.enter)}>
            <textarea
              className={styles.note}
              value={note}
              maxLength={120}
              placeholder="e.g. I find word problems hard (optional)"
              onChange={event => setNote(event.target.value)}
              data-testid="goal-note"
            />
            <div className={styles.rowCenter}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void submit(note)}
                data-testid="goal-note-continue"
              >
                Show me where to start
              </button>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void submit('')}
                data-testid="goal-note-skip"
              >
                Skip
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'results' ? (
          <div className={styles.resultsSheet} data-testid="goal-results">
            {hasResults ? (
              <>
                {blocks.map(({ id, block }) => (
                  <AssistantBlockRenderer
                    key={id}
                    block={block}
                    disabled
                    sessionComplete
                    onMcqAnswer={() => {}}
                    onAdvance={() => {}}
                    onFinish={onDone}
                    onConfirm={() => {}}
                    onDismiss={() => {}}
                  />
                ))}
                <div className={styles.resultActions}>
                  <button
                    type="button"
                    className={styles.primaryDark}
                    onClick={startNow}
                    data-testid="goal-start-now"
                  >
                    <PlayIcon className={styles.btnIcon} />
                    Start now
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={saveForLater}
                    data-testid="goal-save-later"
                  >
                    <ArrowsPointingInIcon className={styles.btnIcon} />
                    Save to Today’s path
                  </button>
                </div>
              </>
            ) : (
              <>
                {error ? <p className={styles.error}>{error}</p> : null}
                <div className={styles.resultActions}>
                  <button
                    type="button"
                    className={styles.primaryDark}
                    onClick={() => void submit(note)}
                    data-testid="goal-retry"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={onDone}
                  >
                    Skip for now
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.footer}>
        {phase === 'step' ? (
          <button type="button" className={styles.ghost} onClick={close}>
            Skip for now
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}

export default GoalIntakeScreen
