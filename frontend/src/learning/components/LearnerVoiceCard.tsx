import { makeStyles } from '@fluentui/react-components'
import { useEffect, useState, type FormEvent } from 'react'
import type { LearnerVoiceCard } from '../api'
import { InlineMarkdown } from './AssistantBlockRenderer'

const QUESTION_PREFIX_RE = /\bQuestion\s+\d+\s+of\s+\d+\./
const QUESTION_PARTS_RE = /^(Question\s+\d+\s+of\s+\d+)\.\s*(.*)$/s

function questionText(card: LearnerVoiceCard): string | null {
  if (card.kind === 'mcq-tap') return card.stem
  if (card.kind === 'free-response') return card.prompt
  return null
}

function visibleSpeak(card: LearnerVoiceCard): string {
  const prompt = questionText(card)
  if (!prompt) return card.speak
  let text = card.speak.trim()
  if (text.endsWith(prompt)) text = text.slice(0, -prompt.length).trim()
  const questionPrefix = QUESTION_PREFIX_RE.exec(text)
  if (questionPrefix) text = text.slice(0, questionPrefix.index).trim()
  return text
}

function visibleQuestion(card: LearnerVoiceCard): string {
  const prompt = questionText(card) ?? ''
  const questionPrefix = QUESTION_PREFIX_RE.exec(card.speak)?.[0]
  return questionPrefix ? `${questionPrefix} ${prompt}` : prompt
}

function splitQuestion(value: string): { counter: string | null; body: string } {
  const match = QUESTION_PARTS_RE.exec(value.trim())
  if (!match) return { counter: null, body: value }
  return { counter: match[1], body: match[2] }
}

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    padding: '24px',
    borderRadius: '20px',
    border: '1px solid var(--scrim-card-line)',
    background: 'var(--scrim-card)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  speak: {
    fontSize: '15px',
    lineHeight: 1.5,
    color: 'var(--scrim-fg-soft)',
    fontStyle: 'italic',
  },
  headline: {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
    color: 'var(--scrim-fg-strong)',
  },
  sub: {
    fontSize: '15px',
    color: 'var(--scrim-fg-soft)',
    margin: 0,
  },
  stem: {
    fontSize: '18px',
    lineHeight: 1.45,
    color: 'var(--scrim-fg-strong)',
    margin: 0,
  },
  questionBlock: {
    display: 'grid',
    gap: '10px',
  },
  questionCounter: {
    display: 'inline-flex',
    width: 'fit-content',
    alignItems: 'center',
    minHeight: '28px',
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg-strong)',
    fontSize: '12px',
    fontWeight: 800,
  },
  options: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 540px)': {
      gridTemplateColumns: '1fr',
    },
  },
  option: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: '14px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    fontSize: '15px',
    lineHeight: 1.4,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background .15s ease, transform .12s ease',
    ':hover': { background: 'var(--scrim-chip-hover)' },
    ':active': { transform: 'scale(0.98)' },
    ':disabled': { opacity: 0.5, cursor: 'wait' },
  },
  optionLabel: {
    fontWeight: 600,
    color: 'var(--scrim-vopt-label)',
    minWidth: '20px',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    margin: 0,
    paddingLeft: '20px',
    color: 'var(--scrim-fg)',
    fontSize: '15px',
    lineHeight: 1.5,
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--scrim-fg-strong)',
    margin: 0,
  },
  primaryAction: {
    alignSelf: 'flex-start',
    padding: '12px 20px',
    borderRadius: '999px',
    border: 'none',
    background: 'var(--scrim-mic-bg)',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    ':disabled': { opacity: 0.5, cursor: 'wait' },
  },
  progressNumber: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#ffffff',
  },
  skillMastery: {
    display: 'grid',
    gap: '10px',
    padding: '16px 18px',
    borderRadius: '16px',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    background:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.88))',
    boxShadow:
      '0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 12px 28px rgba(15, 23, 42, 0.06)',
  },
  skillMasteryEyebrow: {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--scrim-fg-muted)',
  },
  skillMasteryValue: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#111827',
  },
  skillMasteryBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    minHeight: '24px',
    padding: '4px 11px',
    borderRadius: '999px',
    border: '1px solid rgba(0, 113, 227, 0.16)',
    background: 'rgba(0, 113, 227, 0.08)',
    color: '#0057b8',
    fontSize: '12px',
    fontWeight: 800,
  },
  freeResponseForm: {
    display: 'grid',
    gap: '12px',
  },
  freeResponseInput: {
    width: '100%',
    minHeight: '96px',
    resize: 'vertical',
    borderRadius: '14px',
    border: '1px solid var(--scrim-line-strong)',
    background: 'var(--scrim-chip)',
    color: 'var(--scrim-fg)',
    padding: '14px 16px',
    font: 'inherit',
    lineHeight: 1.4,
  },
})

export interface LearnerVoiceCardRendererProps {
  card: LearnerVoiceCard
  disabled: boolean
  sessionComplete: boolean
  masterySummary?: {
    skillLabel: string
    probabilityPct: number
    deltaPts: number
  } | null
  onMcqAnswer: (optionId: string) => void
  onFreeResponseAnswer: (answerText: string) => void
  onAdvance: () => void
  onFinish: () => void
}

export function LearnerVoiceCardRenderer({
  card,
  disabled,
  sessionComplete,
  masterySummary,
  onMcqAnswer,
  onFreeResponseAnswer,
  onAdvance,
  onFinish,
}: LearnerVoiceCardRendererProps): JSX.Element {
  const styles = useStyles()
  const [freeResponseText, setFreeResponseText] = useState('')
  const cardId = card.card_id
  const displaySpeak = visibleSpeak(card)
  const displayQuestion = visibleQuestion(card)
  const questionParts = splitQuestion(displayQuestion)

  useEffect(() => {
    if (!cardId) return
    setFreeResponseText('')
  }, [cardId])

  const submitFreeResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const answer = freeResponseText.trim()
    if (!answer || disabled || card.kind !== 'free-response') return
    onFreeResponseAnswer(answer)
  }

  return (
    <article
      className={styles.card}
      data-testid="practice-card"
      data-card-kind={card.kind}
      data-card-id={card.card_id}
    >
      {displaySpeak ? <p className={styles.speak}>{displaySpeak}</p> : null}
      {card.kind === 'greeting' ? (
        <>
          <h2 className={styles.headline}>{card.headline}</h2>
          <p className={styles.sub}>{card.sub}</p>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onAdvance}
            disabled={disabled}
            data-testid="practice-advance"
          >
            Start
          </button>
        </>
      ) : null}
      {card.kind === 'mcq-tap' ? (
        <>
          <div className={styles.questionBlock}>
            {questionParts.counter ? (
              <strong
                className={styles.questionCounter}
                data-testid="practice-question-counter"
              >
                {questionParts.counter}
              </strong>
            ) : null}
            <p className={styles.stem} data-testid="practice-question-text">
              <InlineMarkdown text={questionParts.body} />
            </p>
          </div>
          <div className={styles.options}>
            {card.options.map(option => (
              <button
                key={option.id}
                type="button"
                className={styles.option}
                disabled={disabled}
                onClick={() => onMcqAnswer(option.id)}
                data-testid={`practice-option-${option.id}`}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                <span>
                  <InlineMarkdown text={option.text} />
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {card.kind === 'free-response' ? (
        <form className={styles.freeResponseForm} onSubmit={submitFreeResponse}>
          <div className={styles.questionBlock}>
            {questionParts.counter ? (
              <strong
                className={styles.questionCounter}
                data-testid="practice-question-counter"
              >
                {questionParts.counter}
              </strong>
            ) : null}
            <p className={styles.stem} data-testid="practice-question-text">
              <InlineMarkdown text={questionParts.body} />
            </p>
          </div>
          <textarea
            className={styles.freeResponseInput}
            value={freeResponseText}
            placeholder={card.placeholder ?? 'Type your answer, or say it out loud'}
            onChange={event => setFreeResponseText(event.target.value)}
            disabled={disabled}
            data-testid="practice-free-response-input"
          />
          <button
            type="submit"
            className={styles.primaryAction}
            disabled={disabled || freeResponseText.trim() === ''}
            data-testid="practice-free-response-submit"
          >
            {card.submit_label ?? 'Check answer'}
          </button>
        </form>
      ) : null}
      {card.kind === 'explanation' ? (
        <>
          <h3 className={styles.title}>{card.title}</h3>
          <ol className={styles.steps}>
            {card.steps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onAdvance}
            disabled={disabled}
            data-testid="practice-advance"
          >
            {card.next_action_label}
          </button>
        </>
      ) : null}
      {card.kind === 'progress' ? (
        <>
          <div className={styles.progressNumber}>
            {card.completed} / {card.total}
          </div>
          {sessionComplete && masterySummary ? (
            <div
              className={styles.skillMastery}
              data-testid="practice-skill-mastery"
            >
              <span className={styles.skillMasteryEyebrow}>
                Current skill mastery
              </span>
              <span className={styles.skillMasteryValue}>
                {masterySummary.skillLabel}: {masterySummary.probabilityPct}%
              </span>
              {masterySummary.deltaPts > 0 ? (
                <span className={styles.skillMasteryBadge}>
                  +{masterySummary.deltaPts} pts this session
                </span>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className={styles.primaryAction}
            onClick={sessionComplete ? onFinish : onAdvance}
            disabled={disabled}
            data-testid="practice-advance"
          >
            {sessionComplete ? 'Done' : 'Keep going'}
          </button>
        </>
      ) : null}
      {card.kind === 'mark-known' ? (
        <>
          <p className={styles.stem}>
            <InlineMarkdown text={card.prompt} />
          </p>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onAdvance}
            disabled={disabled}
            data-testid="practice-advance"
          >
            {card.confirm_label}
          </button>
        </>
      ) : null}
    </article>
  )
}

export default LearnerVoiceCardRenderer
