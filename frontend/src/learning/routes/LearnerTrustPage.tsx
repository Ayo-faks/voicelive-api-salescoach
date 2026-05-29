import { Text, makeStyles } from '@fluentui/react-components'
import {
  CheckBadgeIcon,
  ClipboardDocumentListIcon,
  LightBulbIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api'
import type { SafetyConfig } from '../../types'
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
  const [safety, setSafety] = useState<SafetyConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .getConfig()
      .then(cfg => {
        if (!cancelled && cfg.safety) setSafety(cfg.safety)
      })
      .catch(() => {
        // Fail-closed message: assume voice unavailable if config can't load.
        if (!cancelled)
          setSafety({
            learner_voice_disabled: true,
            session_turn_cap: null,
            session_token_cap: null,
            production_content_review_required: false,
          })
      })
    return () => {
      cancelled = true
    }
  }, [])
  const voiceDisabled = safety?.learner_voice_disabled === true
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

      <article className={styles.card} data-testid="learner-trust-live-status">
        <div className={styles.row}>
          <ShieldCheckIcon className={styles.icon} aria-hidden="true" />
          <div>
            <div className={styles.rowTitle}>Right now</div>
            <p
              className={styles.rowBody}
              data-testid="learner-trust-voice-status"
            >
              {voiceDisabled
                ? 'Voice practice is temporarily unavailable. Everything else still works.'
                : 'Voice practice is available. You can use it whenever you are ready.'}
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
