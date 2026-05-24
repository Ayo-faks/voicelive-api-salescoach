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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '18px',
    padding: '12px 14px',
    borderRadius: t.radius.lg,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
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
    color: t.brand.text,
  },
  hint: {
    fontSize: '0.76rem',
    color: t.brand.textTertiary,
  },
  dropdown: {
    minWidth: '220px',
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

  const selectedChild = learners.find(child => child.id === selectedLearnerId) ?? learners[0]

  return (
    <section className={styles.shell} data-testid="learner-selector-shell">
      <div className={styles.copy}>
        <Text className={styles.label}>Learner</Text>
        <Text className={styles.hint}>Diagnostic and voice practice are scoped to this learner.</Text>
      </div>
      <Dropdown
        aria-label="Learner"
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