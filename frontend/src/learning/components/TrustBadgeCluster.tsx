import { makeStyles } from '@fluentui/react-components'
import {
  CheckBadgeIcon,
  ClipboardDocumentListIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import { logEvent } from '../lib/telemetry'

const useStyles = makeStyles({
  trustBadgeWrap: {
    marginTop: '12px',
    minHeight: '44px',
    alignContent: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    appearance: 'none',
    backgroundColor: 'transparent',
    border: 'none',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '0',
    paddingRight: '0',
    cursor: 'pointer',
    color: 'inherit',
    textDecoration: 'none',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: t.brand.text,
      outlineOffset: '4px',
      borderRadius: t.radius.pill,
    },
  },
  trustBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    paddingTop: '4px',
    paddingBottom: '4px',
    paddingLeft: '8px',
    paddingRight: '10px',
    borderRadius: t.radius.pill,
    backgroundColor: t.surface.cardMuted,
    border: t.surface.hairline,
    fontSize: '0.7rem',
    fontWeight: 600,
    color: t.brand.text,
  },
  trustBadgeIcon: { width: '12px', height: '12px' },
})

export const TRUST_BADGES = [
  {
    label: 'Teacher-reviewed',
    title: 'Every recommendation is reviewed by a teacher before it reaches you.',
    Icon: CheckBadgeIcon,
  },
  {
    label: 'Evidence log',
    title: 'Every activity is recorded in an auditable evidence log.',
    Icon: ClipboardDocumentListIcon,
  },
  {
    label: 'Explainable',
    title: 'The tutor explains why it suggested each step in plain language.',
    Icon: LightBulbIcon,
  },
] as const

export const LEARNER_HOME_TRUST_BADGES = TRUST_BADGES.filter(
  badge => badge.label === 'Evidence log'
)

export type TrustBadgeClusterProps = {
  to?: string
  variant?: 'default' | 'learner-home'
}

export function TrustBadgeCluster({
  to = '/trust',
  variant = 'default',
}: TrustBadgeClusterProps): JSX.Element {
  const styles = useStyles()
  const badges = variant === 'learner-home' ? LEARNER_HOME_TRUST_BADGES : TRUST_BADGES
  return (
    <Link
      to={to}
      className={styles.trustBadgeWrap}
      aria-label="View trust and safety details"
      data-testid="learner-trust-badges"
      onClick={() => logEvent('trust_badge_clicked')}
    >
      {badges.map(({ label, title, Icon }) => (
        <span key={label} className={styles.trustBadge} title={title}>
          <Icon className={styles.trustBadgeIcon} aria-hidden="true" />
          {label}
        </span>
      ))}
    </Link>
  )
}

export default TrustBadgeCluster
