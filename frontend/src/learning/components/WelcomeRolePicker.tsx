import { useState } from 'react'
import { Button, Text, makeStyles } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  HomeIcon,
  UserGroupIcon,
  BuildingLibraryIcon,
} from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'
import {
  api,
  type AuthSession,
  type OnboardingIntent,
} from '../../services/api'

const useStyles = makeStyles({
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '32px 20px',
    backgroundColor: t.brand.page,
  },
  inner: {
    width: '100%',
    maxWidth: '960px',
    display: 'grid',
    gap: '28px',
    justifyItems: 'center',
    textAlign: 'center',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: '2rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  subtitle: {
    fontSize: '1rem',
    lineHeight: 1.5,
    color: t.brand.textSecondary,
    maxWidth: '620px',
  },
  tiles: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '20px',
  },
  tile: {
    display: 'grid',
    justifyItems: 'center',
    gap: '12px',
    padding: '28px 22px',
    borderRadius: t.radius.xl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.raisedShadow,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
    ':hover': {
      transform: 'translateY(-2px)',
    },
    ':disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
      transform: 'none',
    },
  },
  tileIcon: {
    width: '40px',
    height: '40px',
    color: t.brand.text,
  },
  tileTitle: {
    fontFamily: t.font.display,
    fontSize: '1.15rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  tileBody: {
    fontSize: '0.9rem',
    lineHeight: 1.45,
    color: t.brand.textSecondary,
  },
  school: {
    marginTop: '8px',
    fontSize: '0.88rem',
    color: t.brand.textSecondary,
  },
  schoolLink: {
    color: t.brand.text,
    fontWeight: 600,
  },
  comingSoon: {
    display: 'inline-block',
    marginTop: '6px',
    padding: '2px 8px',
    borderRadius: '999px',
    backgroundColor: '#f1f3f4',
    color: t.brand.textSecondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  error: {
    color: '#b3261e',
    fontSize: '0.92rem',
  },
})

type Tile = {
  intent: OnboardingIntent
  title: string
  body: string
  icon: typeof AcademicCapIcon
  disabled?: boolean
  comingSoon?: boolean
}

const TILES: Tile[] = [
  {
    intent: 'learner',
    title: "I'm learning",
    body: 'Pick a pathway, practise with voice, and track your own progress.',
    icon: AcademicCapIcon,
  },
  {
    intent: 'parent',
    title: "I'm a parent or guardian",
    body: 'Add the children you support and follow their journey at home.',
    icon: HomeIcon,
  },
  {
    intent: 'teacher',
    title: "I'm a teacher (schools)",
    body: 'Wulo Academy for schools — invite codes and class workspaces are on the way.',
    icon: UserGroupIcon,
    disabled: true,
    comingSoon: true,
  },
]

export type WelcomeRolePickerProps = {
  onChosen: (session: AuthSession, intent: OnboardingIntent) => void
}

export default function WelcomeRolePicker({
  onChosen,
}: WelcomeRolePickerProps) {
  const styles = useStyles()
  const [pending, setPending] = useState<OnboardingIntent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async (intent: OnboardingIntent) => {
    if (pending) return
    const tile = TILES.find(t => t.intent === intent)
    if (tile?.disabled) return
    setPending(intent)
    setError(null)
    try {
      const session = await api.chooseRole(intent)
      onChosen(session, intent)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save your choice'
      )
      setPending(null)
    }
  }

  return (
    <main className={styles.shell} data-testid="welcome-role-picker">
      <div className={styles.inner}>
        <Text as="h1" className={styles.title}>
          Welcome to Wulo Academy
        </Text>
        <Text className={styles.subtitle}>
          To set things up, tell us how you&apos;ll use Wulo Academy. You can
          change this later from your profile.
        </Text>
        <div className={styles.tiles}>
          {TILES.map(tile => {
            const Icon = tile.icon
            const isDisabled = pending !== null || tile.disabled === true
            return (
              <Button
                key={tile.intent}
                appearance="subtle"
                className={styles.tile}
                onClick={() => handlePick(tile.intent)}
                disabled={isDisabled}
                aria-busy={pending === tile.intent}
                aria-disabled={tile.disabled ? true : undefined}
                data-testid={`welcome-tile-${tile.intent}`}
              >
                <Icon className={styles.tileIcon} aria-hidden="true" />
                <Text className={styles.tileTitle}>{tile.title}</Text>
                <Text className={styles.tileBody}>{tile.body}</Text>
                {tile.comingSoon ? (
                  <span
                    className={styles.comingSoon}
                    data-testid={`welcome-tile-${tile.intent}-coming-soon`}
                  >
                    Coming soon
                  </span>
                ) : null}
              </Button>
            )
          })}
        </div>
        {error && (
          <Text className={styles.error} role="alert">
            {error}
          </Text>
        )}
        <Text className={styles.school}>
          <BuildingLibraryIcon
            style={{
              width: 18,
              height: 18,
              verticalAlign: 'middle',
              marginRight: 6,
            }}
            aria-hidden="true"
          />
          Rolling Wulo Academy out across a school? Email us at{' '}
          <a
            className={styles.schoolLink}
            href="mailto:hello@wulo.ai?subject=Wulo%20Academy%20for%20schools"
          >
            hello@wulo.ai
          </a>
        </Text>
      </div>
    </main>
  )
}
