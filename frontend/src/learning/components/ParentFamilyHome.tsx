import { useState } from 'react'
import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { UserPlusIcon, UsersIcon } from '@heroicons/react/24/outline'
import type { ChildProfile } from '../../types'
import { api } from '../../services/api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type ParentFamilyHomeProps = {
  learners: ChildProfile[] | null
  selectedLearnerId: string | null
  onSelectLearner: (childId: string) => void
  onChildCreated: (child: ChildProfile) => void
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
})

export default function ParentFamilyHome({
  learners,
  selectedLearnerId,
  onSelectLearner,
  onChildCreated,
}: ParentFamilyHomeProps) {
  const styles = useStyles()
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loading = learners === null
  const list = learners ?? []

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

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.sectionLabel}>
          <UserPlusIcon className={styles.sectionIcon} aria-hidden="true" />
          <span>Add a child</span>
        </div>
        <div className={styles.form}>
          <div className={styles.formRow}>
            <Field label="Child's name" required>
              <Input
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
