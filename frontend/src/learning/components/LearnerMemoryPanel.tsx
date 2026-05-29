import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, makeStyles } from '@fluentui/react-components'
import { TrashIcon } from '@heroicons/react/24/outline'
import {
  deleteLearnerMemoryFact,
  getLearnerMemory,
  type LearnerMemoryFact,
  type LearnerMemoryListResponse,
} from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const useStyles = makeStyles({
  shell: {
    display: 'grid',
    gap: '12px',
    padding: '20px 22px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '16px',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: '1.05rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  caption: {
    fontSize: '0.78rem',
    color: t.brand.textSecondary,
  },
  group: {
    display: 'grid',
    gap: '6px',
  },
  groupHeading: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: t.brand.textSecondary,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: 'rgba(0,0,0,0.02)',
    fontSize: '0.85rem',
    color: t.brand.text,
  },
  chipKey: {
    fontWeight: 600,
    color: t.brand.textSecondary,
  },
  empty: {
    color: t.brand.textSecondary,
    fontSize: '0.9rem',
  },
  iconButton: {
    minWidth: '24px',
    height: '24px',
    padding: 0,
  },
  icon: {
    width: '14px',
    height: '14px',
  },
})

type Category = 'subjects' | 'schedule' | 'about' | 'mood'

const CATEGORY_LABEL: Record<Category, string> = {
  subjects: 'Subjects & goals',
  schedule: 'Schedule',
  about: 'About you',
  mood: 'Mood (last 3 days)',
}

const KEY_TO_CATEGORY: Record<string, Category> = {
  preferred_subject: 'subjects',
  exam_target: 'subjects',
  exam_board: 'subjects',
  weak_topic: 'subjects',
  strong_topic: 'subjects',
  goal: 'subjects',
  learning_style: 'about',
  preferred_explanation_style: 'about',
  school_name: 'about',
  year_group: 'about',
  key_stage: 'about',
  available_minutes_per_day: 'schedule',
  study_window: 'schedule',
  mood: 'mood',
  confidence_level: 'mood',
  energy: 'mood',
}

function categorise(fact: LearnerMemoryFact): Category {
  return KEY_TO_CATEGORY[fact.fact.key] ?? 'about'
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ')
}

export interface LearnerMemoryPanelProps {
  learnerId: string
  tenantId?: string
}

export function LearnerMemoryPanel({
  learnerId,
  tenantId,
}: LearnerMemoryPanelProps) {
  const styles = useStyles()
  const [state, setState] = useState<LearnerMemoryListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getLearnerMemory(learnerId, tenantId)
      setState(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [learnerId, tenantId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleDelete = useCallback(
    async (factId: string) => {
      try {
        await deleteLearnerMemoryFact(factId, learnerId)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [learnerId, refresh]
  )

  if (loading && !state) {
    return (
      <section className={styles.shell} aria-busy="true">
        <Spinner size="tiny" label="Loading memory…" />
      </section>
    )
  }

  if (error) {
    return null
  }

  if (!state) {
    return null
  }

  if (!state.consent.accepted) {
    return (
      <section className={styles.shell}>
        <Text className={styles.title}>What I remember about you</Text>
        <Text className={styles.empty}>
          Memory is off. Turn it on to let me remember your subjects,
          goals and study schedule. You can delete anything at any time.
        </Text>
      </section>
    )
  }

  if (state.count === 0) {
    return (
      <section className={styles.shell}>
        <Text className={styles.title}>What I remember about you</Text>
        <Text className={styles.empty}>
          Nothing yet. Tell me your favourite subject or exam goal and
          I'll keep track.
        </Text>
      </section>
    )
  }

  const grouped: Record<Category, LearnerMemoryFact[]> = {
    subjects: [],
    schedule: [],
    about: [],
    mood: [],
  }
  for (const fact of state.facts) {
    grouped[categorise(fact)].push(fact)
  }

  return (
    <section className={styles.shell} aria-label="Learner memory">
      <header className={styles.header}>
        <Text className={styles.title}>What I remember about you</Text>
        <Text className={styles.caption}>
          {state.count} {state.count === 1 ? 'note' : 'notes'} — you control these
        </Text>
      </header>

      {(Object.keys(grouped) as Category[]).map((cat) => {
        const facts = grouped[cat]
        if (!facts.length) return null
        return (
          <div key={cat} className={styles.group}>
            <Text className={styles.groupHeading}>{CATEGORY_LABEL[cat]}</Text>
            <div className={styles.chipRow}>
              {facts.map((fact) => (
                <span key={fact.id} className={styles.chip}>
                  <span className={styles.chipKey}>{formatKey(fact.fact.key)}:</span>
                  <span>{String(fact.fact.value)}</span>
                  <Button
                    appearance="subtle"
                    aria-label={`Delete ${formatKey(fact.fact.key)}`}
                    className={styles.iconButton}
                    icon={<TrashIcon className={styles.icon} />}
                    onClick={() => void handleDelete(fact.id)}
                  />
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

export default LearnerMemoryPanel
