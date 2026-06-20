/**
 * In-page diagnostic runner used by the learner home (F6 wiring).
 *
 * Calls `/api/learning/diagnostic/start` once on mount and then
 * `/api/learning/diagnostic/answer` per submission. Keeps the React tree
 * dependency-light — no router push, no global store. Surfaces completion +
 * pending plan so the parent route can update its UI.
 */
import {
  Button,
  Input,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { useEffect, useRef, useState } from 'react'
import {
  answerDiagnostic,
  startDiagnostic,
  type AnswerDiagnosticResponse,
  type DiagnosticItemPayload,
  type PendingPlanRecord,
  type StartDiagnosticResponse,
} from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

export type DiagnosticPanelProps = {
  skillId?: string
  skillIds?: string[]
  subject?: string
  diagnosticId?: string
  studentId?: string | null
  onCompleted?: (plan: PendingPlanRecord | null) => void
  onItemAnswered?: (result: AnswerDiagnosticResponse) => void
  onError?: (error: Error) => void
}

const useStyles = makeStyles({
  panel: {
    display: 'grid',
    gap: '14px',
    padding: '20px',
    borderRadius: t.radius.xl,
    border: `1px solid var(--pf-line)`,
    backgroundColor: 'var(--pf-surface)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  prompt: {
    fontSize: '1.05rem',
    fontWeight: 600,
    color: 'var(--pf-text)',
    lineHeight: 1.4,
  },
  meta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: 'var(--pf-text-secondary)',
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,1fr) auto',
    gap: '8px',
  },
  hint: {
    gridColumn: '1 / -1',
    margin: 0,
    fontSize: '0.78rem',
    color: 'var(--pf-text-secondary)',
  },
  feedback: {
    fontSize: '0.85rem',
    color: 'var(--pf-text-secondary)',
  },
  feedbackCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: t.radius.control,
    border: `1px solid var(--pf-line)`,
    backgroundColor: 'var(--pf-surface-muted)',
  },
  feedbackCardCorrect: {
    border: '1px solid var(--pf-status-ok-fg)',
    backgroundColor: 'rgba(34, 134, 58, 0.08)',
    animationName: {
      from: { opacity: 0, transform: 'scale(0.96)' },
      to: { opacity: 1, transform: 'scale(1)' },
    },
    animationDuration: '160ms',
    animationTimingFunction: 'ease-out',
    '@media (prefers-reduced-motion: reduce)': {
      animationDuration: '1ms',
    },
  },
  feedbackCardWrong: {
    border: '1px solid var(--pf-status-critical-fg)',
    backgroundColor: 'rgba(176, 0, 32, 0.06)',
  },
  feedbackIcon: {
    flexShrink: 0,
    display: 'inline-flex',
    width: '22px',
    height: '22px',
  },
  feedbackIconCorrect: { color: 'var(--pf-status-ok-fg)' },
  feedbackIconWrong: { color: 'var(--pf-status-critical-fg)' },
  feedbackBody: {
    display: 'grid',
    gap: '6px',
    minWidth: 0,
  },
  feedbackTitle: {
    margin: 0,
    fontSize: '0.95rem',
    fontWeight: t.weight.strong,
    color: 'var(--pf-text)',
  },
  feedbackDetail: {
    margin: 0,
    fontSize: '0.85rem',
    color: 'var(--pf-text-secondary)',
    lineHeight: 1.4,
  },
  feedbackActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '2px',
  },
  feedbackExplain: {
    margin: 0,
    fontSize: '0.82rem',
    color: 'var(--pf-text)',
    lineHeight: 1.45,
  },
  completion: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--pf-text)',
  },
})

function displaySkill(value: string) {
  if (!value) return 'This skill'
  // Skill IDs are namespaced like `jss3.algebra.linear` or
  // `ss3.indices.laws_of_indices`. Never leak the raw ID to a learner: take
  // the most specific segment and humanise its separators into a readable
  // topic label ("Laws of indices", "Linear").
  const segment = value.split('.').filter(Boolean).pop() ?? value
  const words = segment.replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'This skill'
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(' ')
}

function languageLabel(value: string) {
  if (value === 'en-NG') return 'English'
  if (value === 'yo-NG') return 'Yoruba'
  return 'In your language'
}

// Skill domains (the second segment of a skill ID like `jss3.algebra.linear`)
// whose diagnostic answers are a single numeric value. Only these should see
// the "type just the value, not x = 5" guidance — literacy/content items
// (English comprehension, grammar, lexis, …) expect a word or short phrase, so
// the numeric hint there reads as a Maths question. Anything not listed here
// falls back to the free-text hint, which is safe for new subjects too.
const NUMERIC_ANSWER_DOMAINS = new Set([
  'algebra',
  'calc',
  'coord',
  'geometry',
  'indices',
  'logarithms',
  'measurement',
  'mensuration',
  'number',
  'number_and_numeration',
  'numberbases',
  'probability',
  'quadratics',
  'sequences',
  'sequences_and_series',
  'sets',
  'statistics',
  'surds',
  'trig',
  'trigonometry',
  'variation',
])

function expectsNumericAnswer(skillId: string): boolean {
  const domain = skillId.split('.').filter(Boolean)[1] ?? ''
  return NUMERIC_ANSWER_DOMAINS.has(domain)
}

/**
 * Normalise a learner's typed answer before it is graded (#10).
 *
 * Learners frequently restate the variable ("x = 5") or pad their answer with
 * extra spacing. An exact-string grader would reject those even when the value
 * is correct, so we strip a leading `<symbol> =` assignment and collapse all
 * runs of whitespace to a single space.
 */
export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9_]*\s*=\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function DiagnosticPanel({
  skillId,
  skillIds,
  subject,
  diagnosticId,
  studentId,
  onCompleted,
  onItemAnswered,
  onError,
}: DiagnosticPanelProps) {
  const styles = useStyles()
  const [session, setSession] = useState<StartDiagnosticResponse | null>(null)
  const [currentItem, setCurrentItem] = useState<DiagnosticItemPayload | null>(
    null
  )
  const [answer, setAnswer] = useState('')
  const [lastResult, setLastResult] = useState<AnswerDiagnosticResponse | null>(
    null
  )
  const [completed, setCompleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showExplain, setShowExplain] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!studentId) {
      setSession(null)
      setCurrentItem(null)
      setBusy(false)
      return
    }
    if (startedRef.current) return
    startedRef.current = true
    setBusy(true)
    startDiagnostic({
      ...(skillIds && skillIds.length > 0 ? { skill_ids: skillIds } : {}),
      ...(skillId ? { skill_id: skillId } : {}),
      ...(diagnosticId ? { diagnostic_id: diagnosticId } : {}),
      ...(subject ? { subject } : {}),
      ...(studentId ? { student_id: studentId } : {}),
    })
      .then(payload => {
        setSession(payload)
        setCurrentItem(payload.item)
      })
      .catch((err: Error) => {
        setError(err.message)
        onError?.(err)
      })
      .finally(() => setBusy(false))
  }, [skillId, skillIds, subject, diagnosticId, onError, studentId])

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !currentItem || busy) return
    const trimmed = answer.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const result = await answerDiagnostic({
        session_id: session.session_id,
        item_id: currentItem.item_id,
        response_text: normalizeAnswer(trimmed),
      })
      setLastResult(result)
      setAnswer('')
      setShowExplain(false)
      onItemAnswered?.(result)
      if (result.next_item) {
        setCurrentItem(result.next_item)
      }
      if (result.completed) {
        setCompleted(true)
        setCurrentItem(null)
        onCompleted?.(result.pending_plan)
      }
    } catch (err) {
      const e = err as Error
      setError(e.message)
      onError?.(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={styles.panel}
      data-testid="diagnostic-panel"
      aria-busy={busy}
    >
      <div className={styles.header}>
        <Text weight="semibold">Today's check-in</Text>
        <span className={styles.statusPill} data-testid="diagnostic-session">
          {session ? 'In progress' : 'Preparing'}
        </span>
      </div>

      {error && (
        <Text role="alert" style={{ color: 'var(--pf-status-critical-fg)' }}>
          Check-in could not start. Please try again.
        </Text>
      )}

      {currentItem && (
        <form className={styles.controls} onSubmit={submitAnswer}>
          <div style={{ gridColumn: '1 / -1' }}>
            <p className={styles.prompt} data-testid="diagnostic-prompt">
              {currentItem.prompt}
            </p>
            <div className={styles.meta}>
              <span data-testid="diagnostic-skill">
                {displaySkill(currentItem.skill_id)}
              </span>
              <span>{languageLabel(currentItem.lang)}</span>
              {session && (
                <span data-testid="diagnostic-remaining">
                  {session.items_total -
                    (lastResult
                      ? lastResult.items_remaining + 0
                      : session.items_remaining + 1) <
                  0
                    ? 1
                    : Math.max(
                        1,
                        (lastResult?.items_remaining ??
                          session.items_remaining) + 1
                      )}{' '}
                  of {session.items_total} remaining
                </span>
              )}
            </div>
          </div>
          <Input
            value={answer}
            onChange={(_, data) => setAnswer(data.value)}
            placeholder="Type your answer"
            disabled={busy}
            data-testid="diagnostic-answer-input"
            aria-label="Diagnostic answer"
          />
          <Button
            appearance="primary"
            type="submit"
            disabled={busy || !answer.trim()}
            data-testid="diagnostic-submit"
          >
            Submit
          </Button>
          <p className={styles.hint} data-testid="diagnostic-hint">
            {expectsNumericAnswer(currentItem.skill_id) ? (
              <>
                Type just the value — for example <strong>5</strong>, not{' '}
                <strong>x = 5</strong>.
              </>
            ) : (
              'Answer in your own words — a short phrase or sentence is fine.'
            )}
          </p>
        </form>
      )}

      {lastResult && (
        <div
          className={mergeClasses(
            styles.feedbackCard,
            lastResult.correct
              ? styles.feedbackCardCorrect
              : styles.feedbackCardWrong
          )}
          data-testid="diagnostic-feedback"
          role="status"
        >
          <span
            className={mergeClasses(
              styles.feedbackIcon,
              lastResult.correct
                ? styles.feedbackIconCorrect
                : styles.feedbackIconWrong
            )}
            aria-hidden="true"
          >
            {lastResult.correct ? (
              <CheckCircleIcon style={{ width: 22, height: 22 }} />
            ) : (
              <XCircleIcon style={{ width: 22, height: 22 }} />
            )}
          </span>
          <div className={styles.feedbackBody}>
            <p className={styles.feedbackTitle}>
              {lastResult.correct ? 'Correct' : 'Not quite'}
            </p>
            <p className={styles.feedbackDetail}>
              {lastResult.correct
                ? 'Nice — your mastery just went up.'
                : lastResult.expected_answer
                  ? `The expected answer was ${lastResult.expected_answer}.`
                  : 'Review the worked answer with your teacher.'}
            </p>
            {!lastResult.correct && (
              <div className={styles.feedbackActions}>
                <Button
                  appearance="secondary"
                  size="small"
                  type="button"
                  data-testid="diagnostic-explain"
                  onClick={() => setShowExplain(value => !value)}
                >
                  {showExplain ? 'Hide explanation' : 'Explain this'}
                </Button>
              </div>
            )}
            {showExplain && !lastResult.correct && (
              <p
                className={styles.feedbackExplain}
                data-testid="diagnostic-explain-text"
              >
                {lastResult.expected_answer
                  ? `Compare your working with ${lastResult.expected_answer}, then try the next question.`
                  : 'Ask your teacher to walk through this one with you, then keep going.'}
              </p>
            )}
          </div>
        </div>
      )}

      {completed && (
        <Text className={styles.completion} data-testid="diagnostic-completed">
          Check-in complete — a plan suggestion has been sent to your teacher
          for review.
        </Text>
      )}
    </section>
  )
}
