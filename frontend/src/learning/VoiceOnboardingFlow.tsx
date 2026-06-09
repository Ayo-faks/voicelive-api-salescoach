/**
 * Voice-first onboarding — one narrated conversation for the whole setup.
 *
 * After an explicit, auditable CONSENT gate (terms / privacy / AI notice, plus
 * the under-13 guardian email — a short text step the voice agent never owns),
 * Pathfinder narrates the rest of onboarding one thing at a time: exam, year
 * group, subjects, interests, then the study goal. Each answer is a tappable
 * gen-UI card (so the learner can listen and tap, or — in production with the
 * `learner_onboarding` VoiceLive scope — speak), and every answer personalises
 * learning immediately because it is persisted to the same profile / goal stores
 * the planner reads. After the goal, the orb shows a brief "finding your start"
 * state, then reveals recommendations the learner can start now or save to
 * Today's path.
 *
 * Consents stay a deliberate text affirmation: a spoken "sure" is not a sound
 * legal basis, and the minor guardian gate is a safeguarding control. "Type
 * instead" hands off to the classic {@link LearnerOnboardingWizard}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeStyles, mergeClasses } from '@fluentui/react-components'
import {
  ArrowsPointingInIcon,
  PlayIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid'
import {
  recommendFromGoal,
  type AssistantBlock,
  type GoalTimeframe,
} from './api'
import type {
  ConsentInput,
  LearnerProfile,
  LearnerProfilePatch,
  LearnerProfileResponse,
} from '../services/api'
import { AssistantBlockRenderer } from './components/AssistantBlockRenderer'
import { useTtsPlayer } from './hooks/useTtsPlayer'
import {
  CURRENT_CONSENT_VERSION,
  LEARNER_INTEREST_OPTIONS,
  SUBJECTS_BY_EXAM,
  isGuardianEmailRequired,
} from './onboarding/LearnerOnboardingWizard'

export interface VoiceOnboardingFlowProps {
  studentId: string
  profile: LearnerProfile | null
  patch: (patch: LearnerProfilePatch) => Promise<LearnerProfileResponse>
  recordConsent: (input: ConsentInput) => Promise<LearnerProfileResponse>
  /** Finished — typically navigate to /home. Used by "Save to Today's path". */
  onComplete: () => void
  /** "Start now" — begin the recommended exercise immediately, on the exact
   * recommended skill when one is available. Falls back to {@link onComplete}
   * when not provided. */
  onStartPractice?: (skillId?: string) => void
  /** Learner prefers the classic typed wizard. */
  onUseTextInstead: () => void
}

type Phase = 'consent' | 'profile' | 'goal' | 'generating' | 'results'

const EXAM_OPTIONS = ['WAEC', 'NECO', 'JAMB', 'Junior WAEC', 'IGCSE', 'A-Level']
const YEAR_OPTIONS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3']
const AGE_BANDS: Array<{ label: string; value: string }> = [
  { label: 'Under 13', value: 'under-13' },
  { label: '13–15', value: '13-15' },
  { label: '16–17', value: '16-17' },
  { label: '18–24', value: '18-24' },
  { label: '25+', value: '25-plus' },
]
const TIMEFRAMES: Array<{ label: string; value: GoalTimeframe }> = [
  { label: 'This term', value: 'this_term' },
  { label: 'This year', value: 'this_year' },
  { label: 'No deadline', value: 'no_deadline' },
]

// Narrated profile + goal steps, walked one at a time after consent.
type StepKey =
  | 'exam'
  | 'year_group'
  | 'subjects'
  | 'interests'
  | 'goalSubject'
  | 'timeframe'
  | 'note'

const STEP_ORDER: StepKey[] = [
  'exam',
  'year_group',
  'subjects',
  'interests',
  'goalSubject',
  'timeframe',
  'note',
]

const STEP_SAY: Record<StepKey, string> = {
  exam: 'Which exam are you preparing for? WAEC, NECO, JAMB, Junior WAEC, IGCSE, or A-Level?',
  year_group: 'And what class are you in?',
  subjects: 'Which subjects do you want to work on? Pick as many as you like.',
  interests:
    'Any careers or topics you’re curious about? This helps me suggest pathways. You can skip.',
  goalSubject: 'Great. What would you like to focus on first?',
  timeframe: 'And when do you want to be ready?',
  note: 'Last one — anything else you’d like me to know? You can skip.',
}

const STEP_PROMPT: Record<StepKey, string> = {
  exam: 'Which exam are you preparing for?',
  year_group: 'What class are you in?',
  subjects: 'Which subjects do you want to work on?',
  interests: 'Any careers or topics you’re curious about? (optional)',
  goalSubject: 'What do you want to focus on first?',
  timeframe: 'When do you want to be ready?',
  note: 'Anything else? (optional)',
}

const CONSENT_SAY =
  'Welcome to Wulo Academy. First, a quick check — please confirm you agree to the terms, privacy notice, and AI notice. Then we’ll set up your learning by voice.'
const GENERATING_SAY = 'Perfect. Let me line up the best place for you to start.'

let _blockCounter = 0
function nextBlockId(): string {
  _blockCounter += 1
  return `vo-block-${Date.now().toString(36)}-${_blockCounter}`
}

type KeyedBlock = { id: string; block: AssistantBlock }

const useStyles = makeStyles({
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 120,
    background: 'var(--scrim-bg-onboarding)',
    color: 'var(--scrim-fg)',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    overflow: 'hidden',
    transformOrigin: 'bottom right',
    transition: 'transform 280ms ease, opacity 280ms ease',
  },
  scrimMinimizing: { transform: 'scale(0.16) translate(42%, 46%)', opacity: 0 },
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
  textLink: {
    border: 'none',
    background: 'transparent',
    color: 'var(--scrim-fg-soft)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    textDecoration: 'underline',
  },
  body: {
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'center',
    gap: '24px',
    padding: '20px 20px 8px',
    overflowY: 'auto',
  },
  orb: {
    width: 'min(150px, 38vw)',
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
  status: { display: 'grid', gap: '6px', textAlign: 'center' },
  stateTitle: { fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.01em' },
  stateHint: { color: 'var(--scrim-fg-soft)', fontSize: '0.92rem' },
  card: {
    display: 'grid',
    gap: '14px',
    width: 'min(560px, 100%)',
    justifyItems: 'center',
  },
  prompt: {
    fontSize: '1.12rem',
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
    padding: '13px 20px',
    borderRadius: '16px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    cursor: 'pointer',
    fontSize: '0.98rem',
    fontWeight: 600,
    minHeight: '50px',
    transition: 'background 140ms ease, transform 140ms ease',
    ':hover': {
      background: 'var(--scrim-chip-hover)',
      transform: 'translateY(-1px)',
    },
  },
  optionActive: {
    background: 'var(--scrim-fill)',
    color: 'var(--scrim-on-fill)',
    border: '1px solid var(--scrim-fill)',
  },
  input: {
    width: '100%',
    padding: '13px 16px',
    borderRadius: '14px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    fontSize: '0.98rem',
    fontFamily: 'inherit',
  },
  note: { minHeight: '64px' },
  consentList: { display: 'grid', gap: '12px', width: '100%' },
  consentRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    fontSize: '0.92rem',
    color: 'var(--scrim-fg)',
    cursor: 'pointer',
  },
  checkbox: { marginTop: '2px', width: '18px', height: '18px', flexShrink: 0 },
  fieldLabel: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--scrim-fg-soft)',
    alignSelf: 'start',
  },
  rowCenter: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  error: { color: '#ffd0c4', fontSize: '0.9rem', textAlign: 'center' },
  resultsSheet: {
    width: 'min(620px, 100%)',
    borderRadius: '20px',
    background: 'var(--scrim-fill)',
    color: 'var(--scrim-on-fill)',
    padding: '20px',
    display: 'grid',
    gap: '14px',
    boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
  },
  resultActions: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '16px 24px 26px',
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

export function VoiceOnboardingFlow({
  studentId,
  profile,
  patch,
  recordConsent,
  onComplete,
  onStartPractice,
  onUseTextInstead,
}: VoiceOnboardingFlowProps): JSX.Element {
  const styles = useStyles()
  const tts = useTtsPlayer()
  const speak = useCallback((text: string) => void tts.play(text), [tts])

  const [phase, setPhase] = useState<Phase>('consent')
  const [stepIndex, setStepIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minimizing, setMinimizing] = useState(false)
  const minimizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Consent-gate fields.
  const [name, setName] = useState(profile?.display_name ?? '')
  const [ageBand, setAgeBand] = useState<string | null>(
    profile?.age_band ?? null
  )
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [aiNotice, setAiNotice] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [guardianEmail, setGuardianEmail] = useState(
    profile?.guardian_email ?? ''
  )

  // Collected onboarding answers.
  const [exam, setExam] = useState<string | null>(profile?.exam ?? null)
  const [subjects, setSubjects] = useState<string[]>(profile?.subjects ?? [])
  const [interests, setInterests] = useState<string[]>(
    profile?.interests ?? []
  )
  const [goalSubject, setGoalSubject] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<GoalTimeframe | null>(null)
  const [note, setNote] = useState('')
  const [blocks, setBlocks] = useState<KeyedBlock[]>([])

  const minor = !!ageBand && isGuardianEmailRequired(ageBand)
  const consentReady =
    name.trim().length > 0 &&
    !!ageBand &&
    terms &&
    privacy &&
    aiNotice &&
    (!minor || guardianEmail.trim().length > 0)

  const subjectOptions = useMemo(
    () => SUBJECTS_BY_EXAM[exam ?? 'WAEC'] ?? SUBJECTS_BY_EXAM.WAEC,
    [exam]
  )

  // Greet the learner by voice at the very start of onboarding. Browsers block
  // audio autoplay until a user gesture, so the welcome (CONSENT_SAY) can't be
  // narrated on mount — that's why narration previously only began on the
  // second screen (after the "Continue" click unlocked audio). Instead we speak
  // the welcome on the learner's FIRST interaction with the consent screen
  // (typing their name, ticking a box, or any tap), which is the earliest point
  // a browser will allow audio. Fires once, then detaches.
  const greetedRef = useRef(false)
  useEffect(() => {
    if (phase !== 'consent' || greetedRef.current) return
    const greet = () => {
      if (greetedRef.current) return
      greetedRef.current = true
      window.removeEventListener('pointerdown', greet)
      window.removeEventListener('keydown', greet)
      speak(CONSENT_SAY)
    }
    window.addEventListener('pointerdown', greet)
    window.addEventListener('keydown', greet)
    return () => {
      window.removeEventListener('pointerdown', greet)
      window.removeEventListener('keydown', greet)
    }
  }, [phase, speak])

  const submitConsent = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await recordConsent({ kind: 'terms', version: CURRENT_CONSENT_VERSION, granted: true })
      await recordConsent({ kind: 'privacy', version: CURRENT_CONSENT_VERSION, granted: true })
      await recordConsent({ kind: 'ai_notice', version: CURRENT_CONSENT_VERSION, granted: true })
      if (analytics) {
        await recordConsent({
          kind: 'analytics',
          version: CURRENT_CONSENT_VERSION,
          granted: true,
        })
      }
      const profilePatch: LearnerProfilePatch = {
        display_name: name.trim(),
        age_band: ageBand ?? undefined,
        locale: profile?.locale || 'en-NG',
        country: profile?.country || 'NG',
      }
      if (minor && guardianEmail.trim())
        profilePatch.guardian_email = guardianEmail.trim()
      await patch(profilePatch)
      setPhase('profile')
      setStepIndex(0)
      speak(STEP_SAY.exam)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details.')
    } finally {
      setBusy(false)
    }
  }, [
    recordConsent,
    analytics,
    name,
    ageBand,
    minor,
    guardianEmail,
    profile,
    patch,
    speak,
  ])

  const submitGoal = useCallback(
    async (finalNote: string) => {
      setPhase('generating')
      setError(null)
      speak(GENERATING_SAY)
      try {
        const result = await recommendFromGoal({
          student_id: studentId || undefined,
          subject: goalSubject ?? undefined,
          exam: exam ?? undefined,
          target_date: timeframe ?? undefined,
          note: finalNote.trim() || undefined,
        })
        setBlocks(result.blocks.map(block => ({ id: nextBlockId(), block })))
        const prose = result.blocks.find(b => b.kind === 'prose') as
          | { speak?: string; text?: string }
          | undefined
        if (prose) speak(prose.speak || prose.text || '')
        setPhase('results')
      } catch {
        setError('Could not get recommendations just now.')
        setPhase('results')
      }
    },
    [studentId, goalSubject, exam, timeframe, speak]
  )

  const advance = useCallback(() => {
    const next = stepIndex + 1
    if (next >= STEP_ORDER.length) return
    setStepIndex(next)
    setPhase(STEP_ORDER[next] === 'goalSubject' ? 'goal' : phase)
    speak(STEP_SAY[STEP_ORDER[next]])
  }, [stepIndex, phase, speak])

  // Persist a profile field, then move on (fire-and-forget; errors surface but
  // never block the conversation — the field can re-sync from a later step).
  const persistAndAdvance = useCallback(
    (p: LearnerProfilePatch) => {
      void patch(p).catch(() => {})
      advance()
    },
    [patch, advance]
  )

  const onPickSingle = useCallback(
    (key: StepKey, value: string | null) => {
      if (key === 'exam') {
        setExam(value)
        persistAndAdvance({ exam: value ?? undefined })
      } else if (key === 'year_group') {
        persistAndAdvance({ year_group: value ?? undefined })
      } else if (key === 'goalSubject') {
        setGoalSubject(value)
        advance()
      } else if (key === 'timeframe') {
        setTimeframe(value as GoalTimeframe | null)
        advance()
      }
    },
    [persistAndAdvance, advance]
  )

  const toggleInList = useCallback(
    (list: string[], setList: (v: string[]) => void, value: string, max: number) => {
      if (list.includes(value)) setList(list.filter(v => v !== value))
      else if (list.length < max) setList([...list, value])
    },
    []
  )

  const startNow = useCallback(() => {
    tts.stop()
    // Land the learner on the EXACT recommended skill: pull the first
    // PlanBlock step's skill_id (same contract GoalIntakeScreen uses) and hand
    // it to onStartPractice so /home opens practice on that skill rather than
    // the planner's own first pick. Falls back to onComplete when the caller
    // doesn't wire a practice handler.
    if (onStartPractice) {
      const planBlock = blocks.find(b => b.block.kind === 'plan')
      const firstSkill =
        planBlock && planBlock.block.kind === 'plan'
          ? (planBlock.block.steps.find(s => s.skill_id)?.skill_id ?? undefined)
          : undefined
      onStartPractice(firstSkill ?? undefined)
    } else {
      onComplete()
    }
  }, [tts, onStartPractice, onComplete, blocks])

  const saveForLater = useCallback(() => {
    tts.stop()
    setMinimizing(true)
    minimizeTimer.current = setTimeout(onComplete, 280)
  }, [tts, onComplete])

  const switchToText = useCallback(() => {
    tts.stop()
    onUseTextInstead()
  }, [tts, onUseTextInstead])

  const hasResults = blocks.length > 0
  const currentKey = STEP_ORDER[stepIndex]

  const orbClass = mergeClasses(
    styles.orb,
    phase === 'generating'
      ? styles.orbThinking
      : tts.playing
        ? styles.orbSpeaking
        : styles.orbBreathing
  )

  const statusTitle = useMemo(() => {
    if (phase === 'consent') return 'Welcome to Wulo Academy'
    if (phase === 'generating') return 'Finding your starting point…'
    if (phase === 'results')
      return hasResults ? 'Here’s where to start' : 'Let’s try that again'
    return tts.playing ? 'Listening…' : 'Your turn'
  }, [phase, hasResults, tts.playing])

  const statusHint = useMemo(() => {
    if (phase === 'consent')
      return 'A quick agreement, then we set up your learning by voice.'
    if (phase === 'generating') return 'Personalising your first steps.'
    if (phase === 'results')
      return hasResults
        ? 'Start now, or save it to Today’s path for later.'
        : 'Something went wrong reaching your plan.'
    return 'Tap your answer, or listen and pick when ready.'
  }, [phase, hasResults])

  return (
    <div
      className={mergeClasses(styles.scrim, minimizing && styles.scrimMinimizing)}
      data-testid="voice-onboarding"
    >
      <div className={styles.header}>
        <span className={styles.brand}>
          <span className={styles.brandDot} />
          Wulo Academy
        </span>
        <button
          type="button"
          className={styles.textLink}
          onClick={switchToText}
          data-testid="onboarding-use-text"
        >
          Type instead
        </button>
      </div>

      <div className={styles.body}>
        <div className={orbClass} />
        <div className={styles.status}>
          <div className={styles.stateTitle}>{statusTitle}</div>
          <div className={styles.stateHint}>{statusHint}</div>
        </div>

        {/* ---- Consent gate (text, required, auditable) ---- */}
        {phase === 'consent' ? (
          <div className={styles.card}>
            <span className={styles.fieldLabel}>What should I call you?</span>
            <input
              className={styles.input}
              value={name}
              maxLength={80}
              placeholder="Your name"
              onChange={e => setName(e.target.value)}
              data-testid="onboarding-name"
            />
            <span className={styles.fieldLabel}>Your age</span>
            <div className={styles.options}>
              {AGE_BANDS.map(a => (
                <button
                  key={a.value}
                  type="button"
                  className={mergeClasses(
                    styles.option,
                    ageBand === a.value && styles.optionActive
                  )}
                  onClick={() => setAgeBand(a.value)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className={styles.consentList}>
              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={terms}
                  onChange={e => setTerms(e.target.checked)}
                  data-testid="onboarding-terms"
                />
                I agree to the Wulo terms of service.
              </label>
              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={privacy}
                  onChange={e => setPrivacy(e.target.checked)}
                  data-testid="onboarding-privacy"
                />
                I have read the privacy notice.
              </label>
              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={aiNotice}
                  onChange={e => setAiNotice(e.target.checked)}
                  data-testid="onboarding-ai"
                />
                I understand Wulo Academy uses AI to suggest activities and
                pathways.
              </label>
              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={analytics}
                  onChange={e => setAnalytics(e.target.checked)}
                />
                Optional: share anonymous usage analytics to help us improve.
              </label>
              {minor ? (
                <>
                  <span className={styles.fieldLabel}>
                    Guardian email (required under 13)
                  </span>
                  <input
                    className={styles.input}
                    type="email"
                    value={guardianEmail}
                    placeholder="parent@example.com"
                    onChange={e => setGuardianEmail(e.target.value)}
                    data-testid="onboarding-guardian"
                  />
                </>
              ) : null}
            </div>
            {error ? <p className={styles.error}>{error}</p> : null}
            <div className={styles.rowCenter}>
              <button
                type="button"
                className={styles.primary}
                disabled={!consentReady || busy}
                onClick={() => void submitConsent()}
                data-testid="onboarding-consent-continue"
              >
                <SparklesIcon className={styles.btnIcon} />
                {busy ? 'Saving…' : 'Agree & continue'}
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- Narrated single-choice steps ---- */}
        {(phase === 'profile' || phase === 'goal') &&
        (currentKey === 'exam' ||
          currentKey === 'year_group' ||
          currentKey === 'goalSubject' ||
          currentKey === 'timeframe') ? (
          <div className={styles.card} key={currentKey}>
            <div className={styles.prompt}>{STEP_PROMPT[currentKey]}</div>
            <div className={styles.options}>
              {currentKey === 'exam'
                ? EXAM_OPTIONS.map(o => (
                    <button
                      key={o}
                      type="button"
                      className={styles.option}
                      onClick={() => onPickSingle('exam', o)}
                    >
                      {o}
                    </button>
                  ))
                : null}
              {currentKey === 'year_group'
                ? YEAR_OPTIONS.map(o => (
                    <button
                      key={o}
                      type="button"
                      className={styles.option}
                      onClick={() => onPickSingle('year_group', o)}
                    >
                      {o}
                    </button>
                  ))
                : null}
              {currentKey === 'goalSubject'
                ? [...subjects, 'Something else'].map(o => (
                    <button
                      key={o}
                      type="button"
                      className={styles.option}
                      onClick={() =>
                        onPickSingle(
                          'goalSubject',
                          o === 'Something else' ? null : o
                        )
                      }
                    >
                      {o}
                    </button>
                  ))
                : null}
              {currentKey === 'timeframe'
                ? TIMEFRAMES.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      className={styles.option}
                      onClick={() => onPickSingle('timeframe', o.value)}
                    >
                      {o.label}
                    </button>
                  ))
                : null}
            </div>
          </div>
        ) : null}

        {/* ---- Narrated multi-select steps (subjects / interests) ---- */}
        {phase === 'profile' &&
        (currentKey === 'subjects' || currentKey === 'interests') ? (
          <div className={styles.card} key={currentKey}>
            <div className={styles.prompt}>{STEP_PROMPT[currentKey]}</div>
            <div className={styles.options}>
              {(currentKey === 'subjects'
                ? subjectOptions
                : LEARNER_INTEREST_OPTIONS
              ).map(o => {
                const list = currentKey === 'subjects' ? subjects : interests
                const active = list.includes(o)
                return (
                  <button
                    key={o}
                    type="button"
                    className={mergeClasses(
                      styles.option,
                      active && styles.optionActive
                    )}
                    onClick={() =>
                      currentKey === 'subjects'
                        ? toggleInList(subjects, setSubjects, o, 6)
                        : toggleInList(interests, setInterests, o, 8)
                    }
                  >
                    {o}
                  </button>
                )
              })}
            </div>
            <div className={styles.rowCenter}>
              <button
                type="button"
                className={styles.primary}
                onClick={() =>
                  currentKey === 'subjects'
                    ? persistAndAdvance({ subjects })
                    : persistAndAdvance({ interests })
                }
                data-testid={`onboarding-${currentKey}-continue`}
              >
                Continue
              </button>
              {currentKey === 'interests' ? (
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => advance()}
                  data-testid="onboarding-interests-skip"
                >
                  Skip
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ---- Optional note (final goal step) ---- */}
        {phase === 'goal' && currentKey === 'note' ? (
          <div className={styles.card}>
            <textarea
              className={mergeClasses(styles.input, styles.note)}
              value={note}
              maxLength={120}
              placeholder="e.g. I find word problems hard (optional)"
              onChange={e => setNote(e.target.value)}
              data-testid="onboarding-note"
            />
            <div className={styles.rowCenter}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void submitGoal(note)}
                data-testid="onboarding-note-continue"
              >
                Show me where to start
              </button>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void submitGoal('')}
                data-testid="onboarding-note-skip"
              >
                Skip
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- Results ---- */}
        {phase === 'results' ? (
          <div className={styles.resultsSheet} data-testid="onboarding-results">
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
                    onFinish={onComplete}
                    onConfirm={() => {}}
                    onDismiss={() => {}}
                  />
                ))}
                <div className={styles.resultActions}>
                  <button
                    type="button"
                    className={styles.primaryDark}
                    onClick={startNow}
                    data-testid="onboarding-start-now"
                  >
                    <PlayIcon className={styles.btnIcon} />
                    Start now
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={saveForLater}
                    data-testid="onboarding-save-later"
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
                    onClick={() => void submitGoal(note)}
                    data-testid="onboarding-retry"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={onComplete}
                  >
                    Continue
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.footer}>
        <span />
      </div>
    </div>
  )
}

export default VoiceOnboardingFlow
