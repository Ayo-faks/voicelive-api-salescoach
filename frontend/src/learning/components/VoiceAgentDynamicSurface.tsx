import { useState } from 'react'
import { makeStyles, Text } from '@fluentui/react-components'
import type {
  VoiceAgentActionExecutionResult,
  VoiceAgentActionRecord,
} from '../api'
import {
  confirmVoiceAction,
  executeVoiceAction,
  suggestVoiceAction,
} from '../api'
import type {
  VoiceAgentActionSuggestion,
  VoiceAgentChartSpec,
  VoiceAgentConfirmationSpec,
  VoiceAgentFormSpec,
  VoiceAgentPlanDraftSpec,
  VoiceAgentStudentProfileSpec,
  VoiceAgentTextSpec,
  VoiceAgentUiSpec,
} from '../../types'

const ACCENT = '#0d8a84'

interface VoiceAgentDynamicSurfaceProps {
  uiSpecs: VoiceAgentUiSpec[]
  actionSuggestions: VoiceAgentActionSuggestion[]
  onOpenStudentProfile?: (studentId: string) => void
  actionsEnabled?: boolean
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    maxWidth: '720px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  card: {
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'rgba(255,255,255,0.14)',
    borderRightColor: 'rgba(255,255,255,0.14)',
    borderBottomColor: 'rgba(255,255,255,0.14)',
    borderLeftColor: 'rgba(255,255,255,0.14)',
    borderTopLeftRadius: '14px',
    borderTopRightRadius: '14px',
    borderBottomLeftRadius: '14px',
    borderBottomRightRadius: '14px',
    backgroundColor: 'rgba(20,20,22,0.72)',
    color: 'rgba(255,255,255,0.92)',
    padding: '14px 16px',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  cardTitle: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  bodyText: {
    fontSize: '0.95rem',
    lineHeight: '1.45',
    color: 'rgba(255,255,255,0.95)',
    whiteSpace: 'pre-wrap',
  },
  rowButtons: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  primary: {
    appearance: 'none',
    minHeight: '36px',
    paddingTop: '0',
    paddingBottom: '0',
    paddingLeft: '16px',
    paddingRight: '16px',
    borderTopLeftRadius: '999px',
    borderTopRightRadius: '999px',
    borderBottomLeftRadius: '999px',
    borderBottomRightRadius: '999px',
    borderTopWidth: '0',
    borderRightWidth: '0',
    borderBottomWidth: '0',
    borderLeftWidth: '0',
    backgroundColor: ACCENT,
    color: '#ffffff',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
    ':hover': { filter: 'brightness(1.08)' },
    ':disabled': { opacity: 0.55, cursor: 'not-allowed' },
  },
  secondary: {
    appearance: 'none',
    minHeight: '36px',
    paddingTop: '0',
    paddingBottom: '0',
    paddingLeft: '16px',
    paddingRight: '16px',
    borderTopLeftRadius: '999px',
    borderTopRightRadius: '999px',
    borderBottomLeftRadius: '999px',
    borderBottomRightRadius: '999px',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'rgba(255,255,255,0.18)',
    borderRightColor: 'rgba(255,255,255,0.18)',
    borderBottomColor: 'rgba(255,255,255,0.18)',
    borderLeftColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'transparent',
    color: '#ffffff',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'rgba(255,255,255,0.08)' },
    ':disabled': { opacity: 0.55, cursor: 'not-allowed' },
  },
  pillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.74rem',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '20px',
    paddingLeft: '8px',
    paddingRight: '8px',
    borderTopLeftRadius: '999px',
    borderTopRightRadius: '999px',
    borderBottomLeftRadius: '999px',
    borderBottomRightRadius: '999px',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  pillRisk_low: { backgroundColor: 'rgba(13,138,132,0.30)' },
  pillRisk_medium: { backgroundColor: 'rgba(245,158,11,0.28)' },
  pillRisk_high: { backgroundColor: 'rgba(245,72,72,0.32)' },
  statusOk: { color: '#7be7c4' },
  statusErr: { color: '#ff9aa2' },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '10px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '0.85rem',
    color: 'rgba(255,255,255,0.85)',
  },
  input: {
    appearance: 'none',
    minHeight: '36px',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '10px',
    paddingRight: '10px',
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '10px',
    borderBottomLeftRadius: '10px',
    borderBottomRightRadius: '10px',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'rgba(255,255,255,0.16)',
    borderRightColor: 'rgba(255,255,255,0.16)',
    borderBottomColor: 'rgba(255,255,255,0.16)',
    borderLeftColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.32)',
    color: '#ffffff',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
  },
})

function TextBlock({ spec }: { spec: VoiceAgentTextSpec }) {
  const styles = useStyles()
  return (
    <div className={styles.card}>
      {spec.title && <div className={styles.cardTitle}>{spec.title}</div>}
      <div className={styles.bodyText}>{spec.body}</div>
    </div>
  )
}

function ChartTableBlock({ spec }: { spec: VoiceAgentChartSpec }) {
  const styles = useStyles()
  // Minimal safe render: show title and a compact JSON preview. A full chart
  // renderer can hook in later via the visualization service.
  const preview = JSON.stringify(spec.payload, null, 2).slice(0, 1200)
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        {spec.title ?? (spec.kind === 'chart' ? 'Chart' : 'Table')}
      </div>
      <pre
        className={styles.bodyText}
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}
      >
        {preview}
      </pre>
    </div>
  )
}

function StudentProfileBlock({
  spec,
  onOpen,
}: {
  spec: VoiceAgentStudentProfileSpec
  onOpen?: (studentId: string) => void
}) {
  const styles = useStyles()
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{spec.title ?? 'Student profile'}</div>
      <div className={styles.bodyText}>Student ID: {spec.student_id}</div>
      <div className={styles.rowButtons}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => onOpen?.(spec.student_id)}
          disabled={!onOpen}
        >
          Open profile
        </button>
      </div>
    </div>
  )
}

function PlanDraftBlock({ spec }: { spec: VoiceAgentPlanDraftSpec }) {
  const styles = useStyles()
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{spec.title ?? 'Plan draft'}</div>
      <div className={styles.bodyText}>{spec.summary}</div>
      {spec.plan_id && (
        <div className={styles.pillRow} style={{ marginTop: 8 }}>
          <span className={styles.pill}>plan {spec.plan_id}</span>
        </div>
      )}
    </div>
  )
}

function ConfirmationBlock({ spec }: { spec: VoiceAgentConfirmationSpec }) {
  // Confirmations are handled via ActionSuggestionCard below; this card is
  // shown when the planner emits a standalone confirmation prompt without a
  // matching action_suggestion (rare).
  const styles = useStyles()
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{spec.title ?? 'Confirm'}</div>
      <div className={styles.bodyText}>{spec.prompt}</div>
    </div>
  )
}

function FormBlock({ spec }: { spec: VoiceAgentFormSpec }) {
  const styles = useStyles()
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {}
    for (const field of spec.fields) {
      if (field.default !== undefined) seed[field.name] = field.default
    }
    return seed
  })
  return (
    <div className={styles.card}>
      {spec.title && <div className={styles.cardTitle}>{spec.title}</div>}
      <div className={styles.formGrid}>
        {spec.fields.map(field => {
          const inputId = `vaf-${spec.id ?? 'form'}-${field.name}`
          return (
            <div key={field.name} className={styles.field}>
              <label htmlFor={inputId}>
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              {field.kind === 'textarea' ? (
                <textarea
                  id={inputId}
                  className={styles.input}
                  value={String(values[field.name] ?? '')}
                  placeholder={field.placeholder}
                  onChange={e =>
                    setValues(prev => ({
                      ...prev,
                      [field.name]: e.target.value,
                    }))
                  }
                />
              ) : field.kind === 'select' ? (
                <select
                  id={inputId}
                  className={styles.input}
                  value={String(values[field.name] ?? '')}
                  onChange={e =>
                    setValues(prev => ({
                      ...prev,
                      [field.name]: e.target.value,
                    }))
                  }
                >
                  <option value="">—</option>
                  {(field.options ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  className={styles.input}
                  type={
                    field.kind === 'number'
                      ? 'number'
                      : field.kind === 'date'
                        ? 'date'
                        : 'text'
                  }
                  value={String(values[field.name] ?? '')}
                  placeholder={field.placeholder}
                  onChange={e =>
                    setValues(prev => ({
                      ...prev,
                      [field.name]: e.target.value,
                    }))
                  }
                />
              )}
              {field.help && (
                <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>
                  {field.help}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className={styles.rowButtons}>
        <button type="button" className={styles.primary} disabled>
          {spec.submit_label}
        </button>
        <Text style={{ opacity: 0.6, fontSize: '0.78rem' }}>
          Forms are read-only in preview.
        </Text>
      </div>
    </div>
  )
}

function ActionSuggestionCard({
  suggestion,
  actionsEnabled,
}: {
  suggestion: VoiceAgentActionSuggestion
  actionsEnabled?: boolean
}) {
  const styles = useStyles()
  const [pending, setPending] = useState<VoiceAgentActionRecord | null>(null)
  const [result, setResult] = useState<VoiceAgentActionExecutionResult | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ensureSuggested = async (): Promise<VoiceAgentActionRecord> => {
    if (pending) return pending
    const created = await suggestVoiceAction({
      action_id: suggestion.action_id,
      action_type: suggestion.action_type,
      label: suggestion.label,
      risk_level: suggestion.risk_level,
      requires_confirmation: suggestion.requires_confirmation,
      parameters: suggestion.parameters,
      rationale: suggestion.rationale ?? '',
    })
    setPending(created)
    return created
  }

  const handleConfirmAndExecute = async () => {
    if (!actionsEnabled) return
    setBusy(true)
    setError(null)
    try {
      const created = await ensureSuggested()
      if (suggestion.requires_confirmation) {
        await confirmVoiceAction(created.suggestion_id, 'click')
      }
      const out = await executeVoiceAction(created.suggestion_id)
      setResult(out)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const riskClass =
    suggestion.risk_level === 'high'
      ? styles.pillRisk_high
      : suggestion.risk_level === 'medium'
        ? styles.pillRisk_medium
        : styles.pillRisk_low

  return (
    <div className={styles.card} data-testid="voice-agent-action-card">
      <div className={styles.pillRow}>
        <span className={`${styles.pill} ${riskClass}`}>
          {suggestion.risk_level} risk
        </span>
        <span className={styles.pill}>{suggestion.action_type}</span>
      </div>
      <div className={styles.bodyText} style={{ marginTop: 6 }}>
        {suggestion.label}
      </div>
      {suggestion.rationale && (
        <div
          className={styles.bodyText}
          style={{ marginTop: 6, opacity: 0.78, fontSize: '0.82rem' }}
        >
          {suggestion.rationale}
        </div>
      )}
      {!actionsEnabled && (
        <div
          className={styles.bodyText}
          style={{ marginTop: 8, opacity: 0.7, fontSize: '0.8rem' }}
        >
          Voice actions are disabled for this user.
        </div>
      )}
      {result ? (
        <output
          className={`${styles.bodyText} ${
            result.status === 'success' ? styles.statusOk : styles.statusErr
          }`}
          style={{ marginTop: 8 }}
        >
          {result.status === 'success' ? 'Done — ' : 'Failed — '}
          {result.message}
        </output>
      ) : (
        <div className={styles.rowButtons}>
          <button
            type="button"
            className={styles.primary}
            onClick={handleConfirmAndExecute}
            disabled={!actionsEnabled || busy}
            data-testid="voice-agent-action-confirm"
          >
            {suggestion.requires_confirmation ? 'Confirm & run' : 'Run'}
          </button>
        </div>
      )}
      {error && (
        <div className={`${styles.bodyText} ${styles.statusErr}`} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export function VoiceAgentDynamicSurface({
  uiSpecs,
  actionSuggestions,
  onOpenStudentProfile,
  actionsEnabled = false,
}: VoiceAgentDynamicSurfaceProps) {
  const styles = useStyles()
  if (!uiSpecs.length && !actionSuggestions.length) return null
  return (
    <div className={styles.root} data-testid="voice-agent-dynamic-surface">
      {uiSpecs.map((spec, index) => {
        const key = spec.id ?? `${spec.kind}-${index}`
        switch (spec.kind) {
          case 'text':
            return <TextBlock key={key} spec={spec} />
          case 'chart':
          case 'table':
            return <ChartTableBlock key={key} spec={spec} />
          case 'form':
            return <FormBlock key={key} spec={spec} />
          case 'confirmation':
            return <ConfirmationBlock key={key} spec={spec} />
          case 'studentProfile':
            return (
              <StudentProfileBlock
                key={key}
                spec={spec}
                onOpen={onOpenStudentProfile}
              />
            )
          case 'planDraft':
            return <PlanDraftBlock key={key} spec={spec} />
          case 'actionResult':
            return (
              <div key={key} className={styles.card}>
                <div className={styles.cardTitle}>Result</div>
                <div
                  className={`${styles.bodyText} ${
                    spec.status === 'success'
                      ? styles.statusOk
                      : styles.statusErr
                  }`}
                >
                  {spec.message}
                </div>
              </div>
            )
          default:
            return null
        }
      })}
      {actionSuggestions.map(suggestion => (
        <ActionSuggestionCard
          key={suggestion.action_id}
          suggestion={suggestion}
          actionsEnabled={actionsEnabled}
        />
      ))}
    </div>
  )
}

export default VoiceAgentDynamicSurface
