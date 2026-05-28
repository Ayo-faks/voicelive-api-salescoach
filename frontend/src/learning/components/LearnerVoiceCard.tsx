import { makeStyles } from '@fluentui/react-components'
import type { LearnerVoiceCard } from '../api'

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    padding: '24px',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(20,20,24,0.85)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  },
  speak: {
    fontSize: '15px',
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.78)',
    fontStyle: 'italic',
  },
  headline: {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
    color: '#ffffff',
  },
  sub: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.65)',
    margin: 0,
  },
  stem: {
    fontSize: '18px',
    lineHeight: 1.45,
    color: '#ffffff',
    margin: 0,
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
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#f4f4f6',
    fontSize: '15px',
    lineHeight: 1.4,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background .15s ease, transform .12s ease',
    ':hover': { background: 'rgba(255,255,255,0.08)' },
    ':active': { transform: 'scale(0.98)' },
    ':disabled': { opacity: 0.5, cursor: 'wait' },
  },
  optionLabel: {
    fontWeight: 600,
    color: '#9bd4ff',
    minWidth: '20px',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    margin: 0,
    paddingLeft: '20px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: '15px',
    lineHeight: 1.5,
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  primaryAction: {
    alignSelf: 'flex-start',
    padding: '12px 20px',
    borderRadius: '999px',
    border: 'none',
    background: 'linear-gradient(160deg, #4a4a4d 0%, #0a0a0a 100%)',
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
})

export interface LearnerVoiceCardRendererProps {
  card: LearnerVoiceCard
  disabled: boolean
  sessionComplete: boolean
  onMcqAnswer: (optionId: string) => void
  onAdvance: () => void
  onFinish: () => void
}

export function LearnerVoiceCardRenderer({
  card,
  disabled,
  sessionComplete,
  onMcqAnswer,
  onAdvance,
  onFinish,
}: LearnerVoiceCardRendererProps): JSX.Element {
  const styles = useStyles()
  return (
    <article
      className={styles.card}
      data-testid="practice-card"
      data-card-kind={card.kind}
      data-card-id={card.card_id}
    >
      <p className={styles.speak}>{card.speak}</p>
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
          <p className={styles.stem}>{card.stem}</p>
          <div className={styles.options}>
            {card.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={styles.option}
                disabled={disabled}
                onClick={() => onMcqAnswer(option.id)}
                data-testid={`practice-option-${option.id}`}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                <span>{option.text}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {card.kind === 'explanation' ? (
        <>
          <h3 className={styles.title}>{card.title}</h3>
          <ol className={styles.steps}>
            {card.steps.map((step, index) => (
              <li key={index}>{step}</li>
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
          <p className={styles.stem}>{card.prompt}</p>
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
