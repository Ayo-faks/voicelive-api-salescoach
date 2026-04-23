import { Button, Spinner, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { APP_RELEASE_LABEL, APP_TITLE } from '../app/branding'

type AuthGateStatus = 'loading' | 'unauthenticated' | 'error'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.86 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.8.54-1.82.86-3.05.86-2.35 0-4.34-1.58-5.05-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.72A5.4 5.4 0 0 1 3.66 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.43 1.33l2.57-2.57C13.45.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" fill="#F25022" />
      <rect x="10" y="1" width="7" height="7" fill="#7FBA00" />
      <rect x="1" y="10" width="7" height="7" fill="#00A4EF" />
      <rect x="10" y="10" width="7" height="7" fill="#FFB900" />
    </svg>
  )
}

const useStyles = makeStyles({
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 'var(--space-lg)',
    background:
      'radial-gradient(circle at 12% 14%, rgba(13, 138, 132, 0.16), transparent 30%), ' +
      'radial-gradient(circle at 86% 82%, rgba(13, 138, 132, 0.12), transparent 32%), ' +
      'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.72), rgba(241, 247, 246, 0.92) 48%, #eef5f3 100%)',
  },
  card: {
    width: 'min(384px, 100%)',
    borderRadius: '20px',
    border: '1px solid rgba(17, 36, 58, 0.08)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,252,252,0.94))',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), ' +
      '0 1px 2px rgba(15,42,58,0.05), ' +
      '0 32px 80px rgba(17, 36, 58, 0.14)',
    padding: '34px 30px 28px',
    display: 'grid',
    gap: '18px',
    justifyItems: 'center',
    textAlign: 'center',
    backdropFilter: 'blur(16px)',
  },
  brandRow: {
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
    gap: '12px',
  },
  brandLockup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
  },
  brandPlatter: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    background:
      'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(232,244,244,0.65) 58%, rgba(13,138,132,0.14) 100%)',
    border: '1px solid rgba(13,138,132,0.18)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.9), ' +
      '0 4px 12px rgba(13,138,132,0.12)',
  },
  brandMark: {
    width: '32px',
    height: '32px',
    objectFit: 'contain',
  },
  brandName: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.08rem',
    fontWeight: '800',
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.03em',
  },
  brandMeta: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.64rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  eyebrow: {
    color: 'var(--color-primary-dark)',
    fontSize: '0.76rem',
    fontWeight: '700',
    letterSpacing: '0.24em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(1.5rem, 3vw, 2rem)',
    lineHeight: 1.1,
    fontWeight: '800',
    letterSpacing: '-0.05em',
    color: 'var(--color-text-primary)',
    maxWidth: '14ch',
    textAlign: 'center',
    justifySelf: 'center',
  },
  loadingTitle: {
    fontSize: 'clamp(1.35rem, 2.6vw, 1.75rem)',
    maxWidth: '16ch',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
    fontSize: '0.92rem',
    maxWidth: '28ch',
    textAlign: 'center',
  },
  actionStack: {
    display: 'grid',
    gap: '10px',
    width: '100%',
  },
  buttonBase: {
    minHeight: '48px',
    width: '100%',
    borderRadius: '12px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.95rem',
    letterSpacing: '-0.01em',
    paddingInline: '16px',
    justifyContent: 'center',
    transition:
      'box-shadow 180ms ease, background 180ms ease, border-color 180ms ease, transform 180ms ease',
  },
  primaryButton: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: '1px solid rgba(6, 98, 94, 0.32)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.32), ' +
      '0 1px 2px rgba(15,42,58,0.08), ' +
      '0 6px 18px rgba(13,138,132,0.28)',
    ':hover': {
      backgroundColor: 'var(--color-primary)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.42), ' +
        '0 2px 4px rgba(15,42,58,0.1), ' +
        '0 10px 24px rgba(13,138,132,0.34)',
    },
    ':active': {
      boxShadow:
        'inset 0 1px 2px rgba(6,98,94,0.35), ' +
        '0 1px 2px rgba(15,42,58,0.08)',
    },
  },
  secondaryButton: {
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,250,250,0.88))',
    color: 'var(--color-text-primary)',
    border: '1px solid rgba(17, 36, 58, 0.12)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), ' +
      '0 1px 2px rgba(15,42,58,0.06)',
    ':hover': {
      background:
        'linear-gradient(180deg, rgba(255,255,255,1), rgba(248,252,252,0.92))',
      border: '1px solid rgba(17, 36, 58, 0.18)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.9), ' +
        '0 2px 4px rgba(15,42,58,0.1), ' +
        '0 8px 18px rgba(15,42,58,0.08)',
    },
    ':active': {
      boxShadow:
        'inset 0 1px 2px rgba(15,42,58,0.12)',
    },
  },
  buttonContent: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
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
        <div className={styles.brandRow}>
          <span className={styles.brandPlatter}>
            <img src="/wulo-logo.png" alt="Wulo logo" className={styles.brandMark} />
          </span>
          <div className={styles.brandLockup}>
            <Text className={styles.brandName}>{APP_TITLE}</Text>
            <Text className={styles.brandMeta}>{APP_RELEASE_LABEL}</Text>
          </div>
        </div>

        {status === 'loading' ? (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={mergeClasses(styles.title, styles.loadingTitle)}>Checking your secure session</Text>
            <Text className={styles.body}>
              Loading your practice workspace and verifying your sign-in state.
            </Text>
            <Spinner size="large" />
          </>
        ) : status === 'error' ? (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={styles.title}>Your session could not be loaded</Text>
            <Text className={styles.body}>Retry the session check or sign in again.</Text>
            {error ? <Text className={styles.errorText}>{error}</Text> : null}
            <div className={styles.actionStack}>
              <Button className={mergeClasses(styles.buttonBase, styles.primaryButton)} onClick={onRetry}>
                Retry session
              </Button>
            </div>
          </>
        ) : (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={styles.title}>Speech practice for everyone</Text>

            {isLocalAuthOrigin() ? (
              <div className={styles.actionStack}>
                <Text className={styles.body}>
                  Local development is running without Azure Easy Auth. Restart the backend with local auth enabled, then recheck the session.
                </Text>
                <Button className={mergeClasses(styles.buttonBase, styles.primaryButton)} onClick={onRetry}>
                  Recheck session
                </Button>
              </div>
            ) : (
              <div className={styles.actionStack}>
                <Button className={mergeClasses(styles.buttonBase, styles.secondaryButton)} onClick={onGoogleSignIn}>
                  <span className={styles.buttonContent}>
                    <GoogleIcon />
                    <span>Continue with Google</span>
                  </span>
                </Button>
                <Button className={mergeClasses(styles.buttonBase, styles.primaryButton)} onClick={onMicrosoftSignIn}>
                  <span className={styles.buttonContent}>
                    <MicrosoftIcon />
                    <span>Continue with Microsoft</span>
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}