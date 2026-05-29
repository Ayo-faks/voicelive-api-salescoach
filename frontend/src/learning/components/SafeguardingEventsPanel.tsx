import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardHeader,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  api,
  type SafeguardingEvent,
  type SafeguardingSeverity,
} from '../../services/api'

type StatusFilter = 'open' | 'acknowledged' | 'all'

const STATUS_LABELS: Record<StatusFilter, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  all: 'All',
}

const SEVERITY_COLOR: Record<SafeguardingSeverity, string> = {
  none: tokens.colorNeutralForeground3,
  low: tokens.colorPaletteYellowForeground1,
  medium: tokens.colorPaletteMarigoldForeground1,
  high: tokens.colorPaletteDarkOrangeForeground1,
  critical: tokens.colorPaletteRedForeground1,
}

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  filters: {
    display: 'flex',
    gap: '6px',
  },
  filterButton: {
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: '999px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: 'transparent',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  filterButtonActive: {
    background: tokens.colorNeutralBackground1Pressed,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '120px 90px 100px 1fr 110px',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    alignItems: 'center',
    cursor: 'pointer',
  },
  rowExpanded: {
    background: tokens.colorNeutralBackground2,
  },
  severityPill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    background: tokens.colorNeutralBackground3,
  },
  detail: {
    padding: '12px 16px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderTop: 'none',
    borderRadius: '0 0 8px 8px',
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  detailSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  contextTurn: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '6px',
  },
  formRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontFamily: 'inherit',
    fontSize: '13px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  errorBanner: {
    padding: '8px 12px',
    borderRadius: '4px',
    background: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    fontSize: '13px',
  },
})

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

interface EventRowProps {
  event: SafeguardingEvent
  expanded: boolean
  onToggle: () => void
  onAcknowledge: (
    id: string,
    body: { action_taken: string; action_notes?: string }
  ) => Promise<void>
  acknowledging: boolean
  ackError: string | null
}

function EventRow({
  event,
  expanded,
  onToggle,
  onAcknowledge,
  acknowledging,
  ackError,
}: EventRowProps) {
  const styles = useStyles()
  const [actionTaken, setActionTaken] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  const isAcknowledged = Boolean(event.acknowledged_at)

  return (
    <div data-testid={`safeguarding-row-${event.id}`}>
      <button
        type="button"
        className={`${styles.row} ${expanded ? styles.rowExpanded : ''}`}
        onClick={onToggle}
        style={{
          width: '100%',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span
          className={styles.severityPill}
          style={{
            color: SEVERITY_COLOR[event.severity],
            borderColor: SEVERITY_COLOR[event.severity],
          }}
          data-testid="safeguarding-severity"
        >
          {event.severity}
        </span>
        <span>{event.direction}</span>
        <span>{isAcknowledged ? 'ack' : 'open'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {event.evidence_quote ?? event.rationale ?? '(no quote)'}
        </span>
        <span style={{ fontSize: 12 }}>{formatTimestamp(event.created_at)}</span>
      </button>
      {expanded && (
        <div className={styles.detail}>
          <div className={styles.detailSection}>
            <Text weight="semibold" size={200}>
              Categories
            </Text>
            <Text size={200}>{event.categories.join(', ') || '—'}</Text>
          </div>
          {event.rationale && (
            <div className={styles.detailSection}>
              <Text weight="semibold" size={200}>
                Rationale
              </Text>
              <Text size={200}>{event.rationale}</Text>
            </div>
          )}
          {event.context_window.length > 0 && (
            <div className={styles.detailSection}>
              <Text weight="semibold" size={200}>
                Context (last {event.context_window.length} turns)
              </Text>
              {event.context_window.map((turn, idx) => (
                <div
                  key={`${idx}-${turn.role}-${turn.text.slice(0, 16)}`}
                  className={styles.contextTurn}
                >
                  <strong>{turn.role}:</strong> {turn.text}
                </div>
              ))}
            </div>
          )}
          <div className={styles.detailSection}>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              child_id: {event.child_id ?? '—'} · session: {event.session_id ?? '—'} ·
              user: {event.user_id ?? '—'}
            </Text>
          </div>
          {isAcknowledged ? (
            <div className={styles.detailSection}>
              <Text weight="semibold" size={200}>
                Acknowledged
              </Text>
              <Text size={200}>
                {event.acknowledged_by ?? 'unknown'} at{' '}
                {event.acknowledged_at
                  ? formatTimestamp(event.acknowledged_at)
                  : ''}
              </Text>
              {event.action_taken && (
                <Text size={200}>
                  <strong>Action:</strong> {event.action_taken}
                </Text>
              )}
              {event.action_notes && (
                <Text size={200}>
                  <strong>Notes:</strong> {event.action_notes}
                </Text>
              )}
            </div>
          ) : (
            <form
              className={styles.form}
              data-testid={`safeguarding-ack-form-${event.id}`}
              onSubmit={async e => {
                e.preventDefault()
                if (!actionTaken.trim()) return
                await onAcknowledge(event.id, {
                  action_taken: actionTaken.trim(),
                  action_notes: actionNotes.trim() || undefined,
                })
                setActionTaken('')
                setActionNotes('')
              }}
            >
              <input
                className={styles.textInput}
                placeholder="Action taken (required, e.g. 'called parent, escalated to DSL')"
                value={actionTaken}
                onChange={e => setActionTaken(e.target.value)}
                required
                data-testid="safeguarding-action-taken"
              />
              <input
                className={styles.textInput}
                placeholder="Notes (optional)"
                value={actionNotes}
                onChange={e => setActionNotes(e.target.value)}
                data-testid="safeguarding-action-notes"
              />
              {ackError && (
                <div className={styles.errorBanner}>{ackError}</div>
              )}
              <div className={styles.formRow}>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={acknowledging || !actionTaken.trim()}
                  data-testid="safeguarding-ack-submit"
                >
                  {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default function SafeguardingEventsPanel() {
  const styles = useStyles()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [events, setEvents] = useState<SafeguardingEvent[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [ackErrors, setAckErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const payload = await api.listSafeguardingEvents(status)
      setEvents(payload.events ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
      setEvents([])
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const handleAcknowledge = useCallback(
    async (
      id: string,
      body: { action_taken: string; action_notes?: string }
    ) => {
      setAcknowledgingId(id)
      setAckErrors(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      try {
        await api.acknowledgeSafeguardingEvent(id, body)
        await load()
        setExpandedId(null)
      } catch (err) {
        setAckErrors(prev => ({ ...prev, [id]: (err as Error).message }))
      } finally {
        setAcknowledgingId(null)
      }
    },
    [load]
  )

  const counts = useMemo(() => {
    if (!events) return { critical: 0, high: 0, other: 0 }
    return events.reduce(
      (acc, ev) => {
        if (ev.severity === 'critical') acc.critical += 1
        else if (ev.severity === 'high') acc.high += 1
        else acc.other += 1
        return acc
      },
      { critical: 0, high: 0, other: 0 }
    )
  }, [events])

  return (
    <Card
      className={styles.card}
      data-testid="safeguarding-events-panel"
    >
      <CardHeader
        header={<Text weight="semibold">Safeguarding events</Text>}
        description={
          <Text size={200}>
            Inbound and outbound utterances flagged by the safeguarding pipeline.
            Critical events trigger admin SMS, admin email, and parent email.
            {events && (
              <>
                {' '}
                <span data-testid="safeguarding-counts">
                  {counts.critical} critical · {counts.high} high ·{' '}
                  {counts.other} other
                </span>
              </>
            )}
          </Text>
        }
      />
      <div className={styles.headerRow}>
        <div className={styles.filters} role="tablist" aria-label="Status filter">
          {(['open', 'acknowledged', 'all'] as StatusFilter[]).map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`${styles.filterButton} ${
                status === s ? styles.filterButtonActive : ''
              }`}
              onClick={() => setStatus(s)}
              data-testid={`safeguarding-filter-${s}`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Button
          size="small"
          appearance="subtle"
          onClick={() => void load()}
          data-testid="safeguarding-refresh"
        >
          Refresh
        </Button>
      </div>

      {loadError && (
        <div
          className={styles.errorBanner}
          data-testid="safeguarding-load-error"
        >
          {loadError}
        </div>
      )}

      {events === null ? (
        <div className={styles.empty} data-testid="safeguarding-loading">
          <Spinner size="tiny" label="Loading safeguarding events…" />
        </div>
      ) : events.length === 0 ? (
        <div className={styles.empty} data-testid="safeguarding-empty">
          No {status === 'all' ? '' : status} safeguarding events.
        </div>
      ) : (
        <div className={styles.list}>
          {events.map(ev => (
            <EventRow
              key={ev.id}
              event={ev}
              expanded={expandedId === ev.id}
              onToggle={() =>
                setExpandedId(prev => (prev === ev.id ? null : ev.id))
              }
              onAcknowledge={handleAcknowledge}
              acknowledging={acknowledgingId === ev.id}
              ackError={ackErrors[ev.id] ?? null}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
