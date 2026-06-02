import { makeStyles, mergeClasses } from '@fluentui/react-components'
import type {
  AssistantBlock,
  AssistantConfirmationBlock,
  AssistantPlanBlock,
  AssistantProfileBlock,
  AssistantProseBlock,
  LearnerVoiceCard,
} from '../api'
import { LearnerVoiceCardRenderer } from './LearnerVoiceCard'

const CARD_KINDS = new Set([
  'greeting',
  'mcq-tap',
  'explanation',
  'progress',
  'mark-known',
])

function isCard(block: AssistantBlock): block is LearnerVoiceCard {
  return CARD_KINDS.has(block.kind)
}

const useStyles = makeStyles({
  prose: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '16px 18px',
    borderRadius: '18px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(20,20,24,0.85)',
    color: '#f4f4f6',
    fontSize: '15px',
    lineHeight: 1.55,
    boxShadow: '0 18px 48px rgba(0,0,0,0.4)',
  },
  proseDeferred: {
    borderTopColor: 'rgba(255,196,84,0.35)',
    borderRightColor: 'rgba(255,196,84,0.35)',
    borderBottomColor: 'rgba(255,196,84,0.35)',
    borderLeftColor: 'rgba(255,196,84,0.35)',
  },
  proseText: {
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  deferBadge: {
    alignSelf: 'flex-start',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: '#ffce7a',
    background: 'rgba(255,196,84,0.12)',
    border: '1px solid rgba(255,196,84,0.3)',
  },
  citations: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '4px',
  },
  citation: {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: '#9bd4ff',
    background: 'rgba(155,212,255,0.1)',
    border: '1px solid rgba(155,212,255,0.25)',
    textDecoration: 'none',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '20px',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(20,20,24,0.85)',
    color: '#f4f4f6',
    boxShadow: '0 18px 48px rgba(0,0,0,0.4)',
  },
  speak: {
    margin: 0,
    fontSize: '14px',
    fontStyle: 'italic',
    color: 'rgba(255,255,255,0.7)',
  },
  headline: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
  },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    minWidth: '92px',
  },
  chipGood: {
    borderTopColor: 'rgba(120,224,143,0.35)',
    borderRightColor: 'rgba(120,224,143,0.35)',
    borderBottomColor: 'rgba(120,224,143,0.35)',
    borderLeftColor: 'rgba(120,224,143,0.35)',
    background: 'rgba(120,224,143,0.08)',
  },
  chipWarn: {
    borderTopColor: 'rgba(255,196,84,0.35)',
    borderRightColor: 'rgba(255,196,84,0.35)',
    borderBottomColor: 'rgba(255,196,84,0.35)',
    borderLeftColor: 'rgba(255,196,84,0.35)',
    background: 'rgba(255,196,84,0.08)',
  },
  chipLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: 'rgba(255,255,255,0.55)',
  },
  chipValue: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#ffffff',
  },
  weakTopics: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  weakTopic: {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: '#ffce7a',
    background: 'rgba(255,196,84,0.1)',
    border: '1px solid rgba(255,196,84,0.25)',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    color: 'rgba(255,255,255,0.85)',
  },
  stepDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'rgba(155,212,255,0.7)',
    flexShrink: 0,
  },
  stepDone: {
    color: 'rgba(255,255,255,0.45)',
    textDecoration: 'line-through',
  },
  confirmRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  confirmPrompt: {
    margin: 0,
    fontSize: '16px',
    color: '#ffffff',
  },
  confirmBtn: {
    padding: '10px 18px',
    borderRadius: '999px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'linear-gradient(160deg, #4a4a4d 0%, #0a0a0a 100%)',
    color: '#ffffff',
    ':disabled': { opacity: 0.5, cursor: 'wait' },
  },
  dismissBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    color: 'rgba(255,255,255,0.75)',
  },
})

function ProseBlockView({ block }: { block: AssistantProseBlock }): JSX.Element {
  const styles = useStyles()
  const deferred = block.grounded === false && block.smalltalk !== true
  return (
    <div
      className={mergeClasses(styles.prose, deferred && styles.proseDeferred)}
      data-testid="assistant-block"
      data-block-kind="prose"
    >
      {deferred ? (
        <span className={styles.deferBadge} data-testid="assistant-defer-badge">
          No grounded source
        </span>
      ) : null}
      <p className={styles.proseText}>{block.text}</p>
      {block.citations.length > 0 ? (
        <div className={styles.citations}>
          {block.citations.map((citation, index) => {
            const key = `${citation.label ?? citation.topic_id ?? citation.url ?? 'cite'}-${index}`
            return citation.url ? (
              <a
                key={key}
                className={styles.citation}
                href={citation.url}
                target="_blank"
                rel="noreferrer"
              >
                {citation.label ?? citation.url}
              </a>
            ) : (
              <span key={key} className={styles.citation}>
                {citation.label ?? citation.topic_id ?? 'source'}
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function ProfileBlockView({
  block,
}: {
  block: AssistantProfileBlock
}): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="profile"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <h3 className={styles.headline}>{block.headline}</h3>
      {block.chips.length > 0 ? (
        <div className={styles.chips}>
          {block.chips.map((chip, index) => (
            <div
              key={`${chip.label}-${index}`}
              className={mergeClasses(
                styles.chip,
                chip.tone === 'good' && styles.chipGood,
                chip.tone === 'warn' && styles.chipWarn
              )}
            >
              <span className={styles.chipLabel}>{chip.label}</span>
              <span className={styles.chipValue}>{chip.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {block.weak_topics.length > 0 ? (
        <div className={styles.weakTopics}>
          {block.weak_topics.map(topic => (
            <span key={topic} className={styles.weakTopic}>
              {topic}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PlanBlockView({ block }: { block: AssistantPlanBlock }): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="plan"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <h3 className={styles.headline}>{block.headline}</h3>
      <ul className={styles.steps}>
        {block.steps.map((step, index) => (
          <li
            key={`${step.title}-${index}`}
            className={mergeClasses(styles.step, step.done && styles.stepDone)}
          >
            <span className={styles.stepDot} />
            {step.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConfirmationBlockView({
  block,
  disabled,
  onConfirm,
  onDismiss,
}: {
  block: AssistantConfirmationBlock
  disabled: boolean
  onConfirm: (block: AssistantConfirmationBlock) => void
  onDismiss: (block: AssistantConfirmationBlock) => void
}): JSX.Element {
  const styles = useStyles()
  return (
    <div
      className={styles.card}
      data-testid="assistant-block"
      data-block-kind="confirmation"
    >
      {block.speak ? <p className={styles.speak}>{block.speak}</p> : null}
      <p className={styles.confirmPrompt}>{block.prompt}</p>
      <div className={styles.confirmRow}>
        <button
          type="button"
          className={styles.confirmBtn}
          disabled={disabled}
          onClick={() => onConfirm(block)}
          data-testid="assistant-confirm"
        >
          {block.confirm_label ?? 'Yes'}
        </button>
        <button
          type="button"
          className={mergeClasses(styles.confirmBtn, styles.dismissBtn)}
          disabled={disabled}
          onClick={() => onDismiss(block)}
          data-testid="assistant-dismiss"
        >
          {block.dismiss_label ?? 'Not now'}
        </button>
      </div>
    </div>
  )
}

export interface AssistantBlockRendererProps {
  block: AssistantBlock
  disabled: boolean
  sessionComplete: boolean
  onMcqAnswer: (optionId: string) => void
  onAdvance: () => void
  onFinish: () => void
  onConfirm: (block: AssistantConfirmationBlock) => void
  onDismiss: (block: AssistantConfirmationBlock) => void
}

/**
 * Renders one assistant block. The five learner-voice cards delegate to the
 * existing {@link LearnerVoiceCardRenderer}; prose/profile/plan/confirmation
 * are rendered here. This is the single seam the merged voice+chat surface
 * uses, so both transports produce identical UI.
 */
export function AssistantBlockRenderer({
  block,
  disabled,
  sessionComplete,
  onMcqAnswer,
  onAdvance,
  onFinish,
  onConfirm,
  onDismiss,
}: AssistantBlockRendererProps): JSX.Element | null {
  if (isCard(block)) {
    return (
      <LearnerVoiceCardRenderer
        card={block}
        disabled={disabled}
        sessionComplete={sessionComplete}
        onMcqAnswer={onMcqAnswer}
        onAdvance={onAdvance}
        onFinish={onFinish}
      />
    )
  }
  if (block.kind === 'prose') {
    return <ProseBlockView block={block} />
  }
  if (block.kind === 'profile') {
    return <ProfileBlockView block={block} />
  }
  if (block.kind === 'plan') {
    return <PlanBlockView block={block} />
  }
  if (block.kind === 'confirmation') {
    return (
      <ConfirmationBlockView
        block={block}
        disabled={disabled}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    )
  }
  return null
}

export default AssistantBlockRenderer
