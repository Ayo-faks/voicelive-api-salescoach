import { Text, makeStyles } from '@fluentui/react-components'
import { UserPlusIcon } from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const useStyles = makeStyles({
  shell: {
    minHeight: '360px',
    display: 'grid',
    placeItems: 'center',
    padding: '32px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
    textAlign: 'center',
  },
  content: {
    display: 'grid',
    justifyItems: 'center',
    gap: '10px',
    maxWidth: '420px',
  },
  icon: {
    width: '44px',
    height: '44px',
    color: t.brand.text,
  },
  title: {
    fontFamily: t.font.display,
    fontSize: '1.35rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  body: {
    fontSize: '0.92rem',
    lineHeight: 1.5,
    color: t.brand.textSecondary,
  },
})

export default function LearnerEmptyState() {
  const styles = useStyles()
  return (
    <section className={styles.shell} data-testid="learner-empty-state">
      <div className={styles.content}>
        <UserPlusIcon className={styles.icon} aria-hidden="true" />
        <Text className={styles.title}>No learners linked to this account yet</Text>
        <Text className={styles.body}>
          Once a learner is linked, their diagnostic check-ins and voice practice will appear here.
        </Text>
      </div>
    </section>
  )
}