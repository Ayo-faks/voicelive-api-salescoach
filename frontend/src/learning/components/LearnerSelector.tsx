import { Dropdown, Option, Text, makeStyles } from '@fluentui/react-components'
import type { ChildProfile } from '../../types'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type LearnerSelectorProps = {
  learners: ChildProfile[]
  selectedLearnerId: string | null
  onChange: (studentId: string) => void
}

const useStyles = makeStyles({
  shell: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '18px',
    padding: '12px 14px',
    borderRadius: t.radius.lg,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-raised)',
    '@media (max-width: 720px)': {
      alignItems: 'stretch',
      flexDirection: 'column',
    },
  },
  copy: {
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  },
  label: {
    fontFamily: t.font.display,
    fontSize: '0.95rem',
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  hint: {
    fontSize: '0.76rem',
    color: 'var(--pf-text-tertiary)',
  },
  dropdown: {
    minWidth: '220px',
    minHeight: t.control.minHeight,
    borderRadius: t.radius.control,
    '@media (max-width: 720px)': { width: '100%' },
  },
})

export default function LearnerSelector({
  learners,
  selectedLearnerId,
  onChange,
}: LearnerSelectorProps) {
  const styles = useStyles()
  if (learners.length <= 1) return null

  const selectedChild =
    learners.find(child => child.id === selectedLearnerId) ?? learners[0]

  return (
    <section className={styles.shell} data-testid="learner-selector-shell">
      <div className={styles.copy}>
        <Text className={styles.label}>Student</Text>
        <Text className={styles.hint}>
          Diagnostic and voice practice are scoped to this student.
        </Text>
      </div>
      <Dropdown
        aria-label="Student"
        className={styles.dropdown}
        value={selectedChild?.name ?? ''}
        selectedOptions={selectedLearnerId ? [selectedLearnerId] : []}
        onOptionSelect={(_, data) => {
          if (data.optionValue) onChange(data.optionValue)
        }}
      >
        {learners.map(child => (
          <Option key={child.id} value={child.id} text={child.name}>
            {child.name}
          </Option>
        ))}
      </Dropdown>
    </section>
  )
}
