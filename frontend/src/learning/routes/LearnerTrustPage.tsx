import { Text, makeStyles } from '@fluentui/react-components'
import {
  CheckBadgeIcon,
  ClipboardDocumentListIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const useStyles = makeStyles({
  root: {
    maxWidth: '760px',
    margin: '32px auto',
    padding: '0 20px',
    display: 'grid',
    gap: '20px',
  },
  hero: {
    display: 'grid',
    gap: '8px',
  },
  eyebrow: {
    fontSize: '0.72rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: t.brand.textSecondary,
  },
  title: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: t.brand.text,
  },
  sub: {
    color: t.brand.textSecondary,
    lineHeight: 1.5,
  },
  card: {
    display: 'grid',
    gap: '10px',
    padding: '18px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.surface.card,
  },
  row: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  icon: {
    width: '24px',
    height: '24px',
    color: t.brand.text,
    flexShrink: 0,
  },
  rowTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  rowBody: {
    fontSize: '0.92rem',
    color: t.brand.textSecondary,
    lineHeight: 1.5,
  },
  back: {
    fontSize: '0.9rem',
    color: t.brand.text,
  },
})

export default function LearnerTrustPage(): JSX.Element {
  const styles = useStyles()
  return (
    <section className={styles.root} data-testid="route-learner-trust">
      <header className={styles.hero}>
        <span className={styles.eyebrow}>Pathfinder · Trust</span>
        <Text as="h1" className={styles.title}>
          How Pathfinder keeps you safe
        </Text>
        <p className={styles.sub}>
          A short, plain-English summary. The full Trust &amp; Safety console
          is reviewed by your teachers and admins.
        </p>
      </header>

      <article className={styles.card}>
        <div className={styles.row}>
          <CheckBadgeIcon className={styles.icon} aria-hidden="true" />
          <div>
            <div className={styles.rowTitle}>Teacher-reviewed</div>
            <p className={styles.rowBody}>
              Every learning plan suggestion is approved by a teacher before it
              becomes part of your path. You can always see who signed off.
            </p>
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.row}>
          <ClipboardDocumentListIcon
            className={styles.icon}
            aria-hidden="true"
          />
          <div>
            <div className={styles.rowTitle}>Evidence log</div>
            <p className={styles.rowBody}>
              We keep a record of the answers and signals used to recommend
              each topic. Your teacher can show you why a topic was suggested.
            </p>
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.row}>
          <LightBulbIcon className={styles.icon} aria-hidden="true" />
          <div>
            <div className={styles.rowTitle}>Explainable</div>
            <p className={styles.rowBody}>
              When the tutor gets something wrong, you can ask &ldquo;explain
              my mistake&rdquo;. We show the reasoning step-by-step instead of
              just an answer.
            </p>
          </div>
        </div>
      </article>

      <Link to="/home" className={styles.back}>
        ← Back to home
      </Link>
    </section>
  )
}
