import { Button, Spinner, Text, makeStyles } from '@fluentui/react-components'

type AuthGateStatus = 'loading' | 'unauthenticated' | 'error'

const useStyles = makeStyles({
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 'var(--space-lg)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.15), transparent 28%), radial-gradient(circle at bottom left, rgba(240, 179, 122, 0.18), transparent 30%), linear-gradient(180deg, #f8fbfb, #eef5f5)',
  },
  card: {
    width: 'min(560px, 100%)',
    borderRadius: 'calc(var(--radius-xl) + 6px)',
    border: '1px solid rgba(17, 36, 58, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    boxShadow: '0 24px 64px rgba(17, 36, 58, 0.12)',
    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
    display: 'grid',
    gap: 'var(--space-lg)',
    backdropFilter: 'blur(14px)',
  },
  eyebrow: {
    color: 'var(--color-primary-dark)',
    fontSize: '0.8rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(2rem, 5vw, 3.25rem)',
    lineHeight: 0.95,
    fontWeight: '800',
    letterSpacing: '-0.05em',
    color: 'var(--color-text-primary)',
    maxWidth: '12ch',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.65,
    fontSize: '0.95rem',
    maxWidth: '48ch',
  },
  actionStack: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  primaryButton: {
    minHeight: '50px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
  },
  secondaryButton: {
    minHeight: '50px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.9)',
    color: 'var(--color-text-primary)',
    border: '1px solid rgba(17, 36, 58, 0.1)',
  },
  trustRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  trustPill: {
    padding: '6px 10px',
    borderRadius: '999px',
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    fontSize: '0.78rem',
    fontWeight: '600',
  },
  errorText: {
    color: '#a11a17',
  },
})

function isLocalAuthOrigin() {
  if (typeof window === 'undefined') return false
  return /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname)
}

interface Props {
  status: AuthGateStatus
  error: string | null
  onRetry: () => void
  onMicrosoftSignIn: () => void
  onGoogleSignIn: () => void
}

export function AuthGateScreen({
  status,
  error,
  onRetry,
  onMicrosoftSignIn,
  onGoogleSignIn,
}: Props) {
  const styles = useStyles()

  return (
    <div className={styles.shell}>
      <section className={styles.card}>
        <Text className={styles.eyebrow}>Wulo</Text>

        {status === 'loading' ? (
          <>
            <Text className={styles.title}>Checking your secure session</Text>
            <Text className={styles.body}>
              Loading your practice workspace and verifying your sign-in state.
            </Text>
            <Spinner size="large" />
          </>
        ) : status === 'error' ? (
          <>
            <Text className={styles.title}>Your session could not be loaded</Text>
            <Text className={styles.body}>Retry the session check or sign in again.</Text>
            {error ? <Text className={styles.errorText}>{error}</Text> : null}
            <div className={styles.actionStack}>
              <Button className={styles.primaryButton} onClick={onRetry}>
                Retry session
              </Button>
            </div>
          </>
        ) : (
          <>
            <Text className={styles.title}>Speech practice for every child</Text>
            <Text className={styles.body}>
              Sign in to start a supervised practice session, review progress, and keep session data saved securely.
            </Text>

            {isLocalAuthOrigin() ? (
              <div className={styles.actionStack}>
                <Text className={styles.body}>
                  Local development is running without Azure Easy Auth. Restart the backend with local auth enabled, then recheck the session.
                </Text>
                <Button className={styles.primaryButton} onClick={onRetry}>
                  Recheck session
                </Button>
              </div>
            ) : (
              <div className={styles.actionStack}>
                <Button className={styles.secondaryButton} onClick={onGoogleSignIn}>
                  Continue with Google
                </Button>
                <Button className={styles.primaryButton} onClick={onMicrosoftSignIn}>
                  Continue with Microsoft
                </Button>
              </div>
            )}

            <div className={styles.trustRow}>
              <span className={styles.trustPill}>Authenticated access</span>
              <span className={styles.trustPill}>Saved session history</span>
              <span className={styles.trustPill}>Role-based review tools</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}