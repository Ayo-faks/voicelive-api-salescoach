import { useRef, useState } from 'react'
import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  UserPlusIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { useNavigate } from 'react-router-dom'
import type { ChildProfile } from '../../types'
import { api } from '../../services/api'
import { featureFlags } from '../../utils/featureFlags'
import { useWeeklyStats } from '../hooks/useWeeklyStats'
import { logEvent } from '../lib/telemetry'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type ParentFamilyHomeProps = {
  learners: ChildProfile[] | null
  selectedLearnerId: string | null
  onSelectLearner: (childId: string) => void
  onChildCreated: (child: ChildProfile) => void
  /** Opens the Wulo Tutor chat panel; omit when the panel is unavailable. */
  onAskAboutResults?: () => void
}

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: 'var(--pf-space-xl)',
    maxWidth: '900px',
  },
  header: {
    display: 'grid',
    gap: 'var(--pf-space-xs)',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  subtitle: {
    fontSize: '0.92rem',
    lineHeight: 1.5,
    color: 'var(--pf-text-secondary)',
  },
  card: {
    display: 'grid',
    gap: 'var(--pf-space-lg)',
    padding: 'var(--pf-space-xl)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: t.font.display,
    fontSize: '1.05rem',
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  sectionIcon: {
    width: '20px',
    height: '20px',
    color: 'var(--pf-text)',
  },
  learnerList: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
  },
  learnerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-md) var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  learnerRowSelected: {
    borderTopColor: 'var(--pf-ink)',
    borderRightColor: 'var(--pf-ink)',
    borderBottomColor: 'var(--pf-ink)',
    borderLeftColor: 'var(--pf-ink)',
    boxShadow: 'var(--pf-focus-outline)',
  },
  learnerName: {
    fontWeight: 600,
    color: 'var(--pf-text)',
  },
  empty: {
    fontSize: '0.9rem',
    color: 'var(--pf-text-tertiary)',
  },
  form: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
  },
  formRow: {
    display: 'grid',
    gap: 'var(--pf-space-md)',
    '@media (min-width: 560px)': {
      gridTemplateColumns: '1fr 200px',
    },
  },
  actions: {
    display: 'flex',
    gap: 'var(--pf-space-md)',
    alignItems: 'center',
  },
  error: {
    fontSize: '0.85rem',
    color: 'var(--pf-status-critical-fg)',
  },
  // Intent chips (flagged): same calm-pill recipe as the learner home —
  // no hover transforms, ≥44px touch target, visible focus ring.
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--pf-space-sm)',
  },
  intentChip: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '44px',
    paddingRight: '16px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    boxShadow: 'var(--pf-shadow-card)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': { backgroundColor: 'var(--pf-surface-muted)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
    },
  },
  intentChipIcon: { width: '18px', height: '18px', flexShrink: 0 },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--pf-space-md)',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
  },
  statCard: {
    display: 'grid',
    gap: 'var(--pf-space-xs)',
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card)',
  },
  statLabel: {
    fontSize: '0.74rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--pf-text-tertiary)',
  },
  statValue: {
    fontFamily: t.font.display,
    fontSize: '1.4rem',
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  statMeaning: {
    fontSize: '0.82rem',
    lineHeight: 1.45,
    color: 'var(--pf-text-secondary)',
  },
})

export default function ParentFamilyHome({
  learners,
  selectedLearnerId,
  onSelectLearner,
  onChildCreated,
  onAskAboutResults,
}: ParentFamilyHomeProps) {
  const styles = useStyles()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loading = learners === null
  const list = learners ?? []

  // --- Home activation (PRD: parent intent chips + per-child stat cards) ---
  const chipsEnabled = featureFlags.pathfinder_home_chips_enabled
  const statsEnabled = featureFlags.pathfinder_actionable_stats_enabled
  const selectedChild = list.find(c => c.id === selectedLearnerId) ?? null
  const childFirstName = selectedChild?.name.split(' ')[0] ?? ''
  const statsSectionRef = useRef<HTMLDivElement | null>(null)
  const addChildInputRef = useRef<HTMLInputElement | null>(null)

  function chipClick(chipId: string, action: () => void) {
    logEvent('home_chip_click', {
      persona: 'parent',
      chip_id: chipId,
      child_id: selectedChild?.id,
    })
    action()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const child = await api.createChild({
        name: trimmed,
        date_of_birth: dob.trim() || undefined,
      })
      onChildCreated(child)
      setName('')
      setDob('')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to add your child'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={styles.shell} data-testid="parent-family-home">
      <div className={styles.header}>
        <Text className={styles.title}>Your family</Text>
        <Text className={styles.subtitle}>
          Add a child to set up their learning profile. You can switch between
          children to see each one&apos;s practice and progress.
        </Text>
      </div>

      {chipsEnabled && (
        <div className={styles.chipRow} data-testid="family-intent-chips">
          {statsEnabled && selectedChild && (
            <button
              type="button"
              className={styles.intentChip}
              onClick={() =>
                chipClick('this-weeks-progress', () => {
                  const reduceMotion = window.matchMedia?.(
                    '(prefers-reduced-motion: reduce)'
                  ).matches
                  statsSectionRef.current?.scrollIntoView?.({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start',
                  })
                })
              }
              aria-label={`See ${childFirstName}'s progress this week`}
              data-testid="family-chip-progress"
            >
              <ChartBarIcon
                className={styles.intentChipIcon}
                aria-hidden="true"
              />
              <span>This week&apos;s progress</span>
            </button>
          )}
          {selectedChild && (
            <button
              type="button"
              className={styles.intentChip}
              onClick={() =>
                chipClick('what-to-practise', () => navigate('/profile'))
              }
              aria-label={`See what ${childFirstName} should practise next`}
              data-testid="family-chip-practise"
            >
              <AcademicCapIcon
                className={styles.intentChipIcon}
                aria-hidden="true"
              />
              <span>What should {childFirstName} practise?</span>
            </button>
          )}
          {selectedChild && onAskAboutResults && (
            <button
              type="button"
              className={styles.intentChip}
              onClick={() => chipClick('ask-about-results', onAskAboutResults)}
              aria-label={`Ask Wulo about ${childFirstName}'s results`}
              data-testid="family-chip-ask"
            >
              <ChatBubbleLeftRightIcon
                className={styles.intentChipIcon}
                aria-hidden="true"
              />
              <span>Ask about {childFirstName}&apos;s results</span>
            </button>
          )}
          <button
            type="button"
            className={styles.intentChip}
            onClick={() =>
              chipClick('add-a-child', () => {
                addChildInputRef.current?.focus()
                addChildInputRef.current?.scrollIntoView?.({
                  block: 'center',
                })
              })
            }
            aria-label="Add a child to your family"
            data-testid="family-chip-add-child"
          >
            <UserPlusIcon
              className={styles.intentChipIcon}
              aria-hidden="true"
            />
            <span>Add a child</span>
          </button>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.sectionLabel}>
          <UsersIcon className={styles.sectionIcon} aria-hidden="true" />
          <span>Children</span>
        </div>
        {loading ? (
          <Spinner size="tiny" label="Loading children…" />
        ) : list.length === 0 ? (
          <Text className={styles.empty}>
            No children added yet. Add your first child below.
          </Text>
        ) : (
          <div className={styles.learnerList}>
            {list.map(child => {
              const selected = child.id === selectedLearnerId
              return (
                <div
                  key={child.id}
                  className={
                    selected
                      ? `${styles.learnerRow} ${styles.learnerRowSelected}`
                      : styles.learnerRow
                  }
                  data-testid="parent-child-row"
                >
                  <Text className={styles.learnerName}>{child.name}</Text>
                  <Button
                    size="small"
                    appearance={selected ? 'primary' : 'secondary'}
                    onClick={() => onSelectLearner(child.id)}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {statsEnabled && selectedChild && (
        <div
          className={styles.card}
          ref={statsSectionRef}
          data-testid="parent-week-card"
        >
          <div className={styles.sectionLabel}>
            <ChartBarIcon className={styles.sectionIcon} aria-hidden="true" />
            <span>{childFirstName}&apos;s week</span>
          </div>
          <ChildWeeklyStats
            key={selectedChild.id}
            child={selectedChild}
            firstName={childFirstName}
          />
        </div>
      )}

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.sectionLabel}>
          <UserPlusIcon className={styles.sectionIcon} aria-hidden="true" />
          <span>Add a child</span>
        </div>
        <div className={styles.form}>
          <div className={styles.formRow}>
            <Field label="Child's name" required>
              <Input
                ref={addChildInputRef}
                value={name}
                onChange={(_, data) => setName(data.value)}
                placeholder="e.g. Amara"
                data-testid="parent-add-child-name"
              />
            </Field>
            <Field label="Date of birth (optional)">
              <Input
                type="date"
                value={dob}
                onChange={(_, data) => setDob(data.value)}
                data-testid="parent-add-child-dob"
              />
            </Field>
          </div>
          {error ? (
            <Text className={styles.error} role="alert">
              {error}
            </Text>
          ) : null}
          <div className={styles.actions}>
            <Button
              type="submit"
              appearance="primary"
              disabled={!name.trim() || submitting}
              data-testid="parent-add-child-submit"
            >
              {submitting ? 'Adding…' : 'Add child'}
            </Button>
          </div>
        </div>
      </form>
    </section>
  )
}

/**
 * Per-child weekly stat cards for the family dashboard (PRD F2, parent
 * persona). Reads the same `GET /api/learning/weekly-stats` the learner home
 * uses — the backend authorises parents for owned children. Cold starts are
 * honest: zeros with encouraging meaning lines, never demo numbers. The
 * weak-topics card is deliberately absent — this surface has no skill-profile
 * data, and we don't pretend "0 weak topics" when we simply don't know.
 */
function ChildWeeklyStats({
  child,
  firstName,
}: {
  child: ChildProfile
  firstName: string
}) {
  const styles = useStyles()
  const weekly = useWeeklyStats(child.id)

  if (weekly.status === 'idle') return null
  if (weekly.status === 'loading') {
    return <Spinner size="tiny" label="Loading this week…" />
  }
  if (weekly.status !== 'ready' || !weekly.stats) {
    return (
      <Text className={styles.empty}>
        This week&apos;s stats aren&apos;t available right now.
      </Text>
    )
  }

  const stats = weekly.stats
  const { completed, target } = stats.sessions
  const remaining = Math.max(0, target - completed)
  const delta = stats.mastery_delta_pct
  const focus = stats.mastery_focus_label
  const streak = stats.streak_days

  const cards = [
    {
      id: 'sessions',
      label: 'Sessions',
      value: `${completed} / ${target}`,
      meaning:
        completed === 0
          ? `No sessions yet this week — a 5-minute check-in is a good start for ${firstName}.`
          : remaining > 0
            ? `${remaining} more ${remaining === 1 ? 'session' : 'sessions'} to hit ${firstName}'s weekly goal.`
            : `${firstName} hit this week's goal — nice work.`,
    },
    {
      id: 'mastery',
      label: 'Mastery',
      value: delta === 0 && !focus ? '—' : `${delta > 0 ? '+' : ''}${delta}%`,
      meaning:
        delta === 0 && !focus
          ? `A few practice sessions will show how ${firstName}'s mastery is moving.`
          : delta >= 0
            ? focus
              ? `${firstName}'s biggest gains this week are in ${focus}.`
              : `${firstName}'s mastery moved up this week.`
            : focus
              ? `${firstName} is slipping a little in ${focus} — a short session helps.`
              : `${firstName}'s mastery dipped this week — a short session helps.`,
    },
    {
      id: 'streak',
      label: 'Streak',
      value: `${streak} ${streak === 1 ? 'day' : 'days'}`,
      meaning:
        streak > 0
          ? `Practising today keeps ${firstName}'s streak going.`
          : `One short session today starts a streak for ${firstName}.`,
    },
  ]

  return (
    <div className={styles.statGrid} data-testid="parent-child-stats">
      {cards.map(card => (
        <div
          key={card.id}
          className={styles.statCard}
          data-testid={`parent-stat-${card.id}`}
        >
          <span className={styles.statLabel}>{card.label}</span>
          <span className={styles.statValue}>{card.value}</span>
          <span className={styles.statMeaning}>{card.meaning}</span>
        </div>
      ))}
    </div>
  )
}
