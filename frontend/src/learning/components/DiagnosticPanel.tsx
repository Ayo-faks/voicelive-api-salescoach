/**
 * In-page diagnostic runner used by the learner home (F6 wiring).
 *
 * Calls `/api/learning/diagnostic/start` once on mount and then
 * `/api/learning/diagnostic/answer` per submission. Keeps the React tree
 * dependency-light — no router push, no global store. Surfaces completion +
 * pending plan so the parent route can update its UI.
 */
import { Button, Input, Text, makeStyles } from '@fluentui/react-components'
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
    border: `1px solid ${t.brand.line}`,
    backgroundColor: t.brand.surface,
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
    color: t.brand.text,
    lineHeight: 1.4,
  },
  meta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: t.brand.textSecondary,
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
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
  feedback: {
    fontSize: '0.85rem',
    color: t.brand.textSecondary,
  },
  feedbackCorrect: {
    fontSize: '0.85rem',
    color: t.status.okFg,
    fontWeight: 600,
  },
  feedbackWrong: {
    fontSize: '0.85rem',
    color: t.status.criticalFg,
    fontWeight: 600,
  },
  completion: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: t.brand.text,
  },
})

function displaySkill(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function languageLabel(value: string) {
  if (value === 'en-NG') return 'English'
  if (value === 'yo-NG') return 'Yoruba'
  return 'Learner language'
}

export default function DiagnosticPanel({
  skillId,
  skillIds,
  subject,
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
  }, [skillId, skillIds, subject, onError, studentId])

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
        response_text: trimmed,
      })
      setLastResult(result)
      setAnswer('')
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
        <Text role="alert" style={{ color: t.status.criticalFg }}>
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
        </form>
      )}

      {lastResult && (
        <Text
          className={
            lastResult.correct ? styles.feedbackCorrect : styles.feedbackWrong
          }
          data-testid="diagnostic-feedback"
        >
          {lastResult.correct
            ? 'Correct — mastery updated.'
            : lastResult.expected_answer
              ? `Not quite. Expected ${lastResult.expected_answer}.`
              : 'Not quite. Review the worked answer with your teacher.'}
        </Text>
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
