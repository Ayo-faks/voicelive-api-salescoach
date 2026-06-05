import {
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { APP_RELEASE_LABEL, APP_TITLE } from '../app/branding'
import { pathfinderTokens as t } from '../learning/theme/pathfinder-tokens'

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
      `radial-gradient(circle at 50% 0%, rgba(0,0,0,0.04), transparent 38%), ${t.surface.page}`,
  },
  card: {
    width: 'min(384px, 100%)',
    borderRadius: t.radius.xxl,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    boxShadow: t.surface.cardElevatedShadow,
    padding: '34px 30px 28px',
    display: 'grid',
    gap: '18px',
    justifyItems: 'center',
    textAlign: 'center',
  },
  brandRow: {
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
    gap: '12px',
  },
  brandLockup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    textAlign: 'center',
  },
  brandPlatter: {
    width: '48px',
    height: '48px',
    borderRadius: t.radius.lg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: t.brand.surfaceMuted,
    border: t.surface.hairline,
    boxShadow: t.surface.raisedShadow,
  },
  brandMark: {
    width: '32px',
    height: '32px',
    objectFit: 'contain',
  },
  brandName: {
    fontFamily: t.font.display,
    fontSize: '1.08rem',
    fontWeight: '700',
    color: t.brand.text,
    letterSpacing: '-0.02em',
  },
  brandMeta: {
    color: t.brand.textTertiary,
    fontSize: '0.64rem',
    fontWeight: '600',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  eyebrow: {
    color: t.brand.textTertiary,
    fontSize: '0.76rem',
    fontWeight: '600',
    letterSpacing: '0.24em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.5rem, 3vw, 2rem)',
    lineHeight: 1.1,
    fontWeight: '700',
    letterSpacing: '-0.03em',
    color: t.brand.text,
    maxWidth: '16ch',
    textAlign: 'center',
    justifySelf: 'center',
  },
  loadingTitle: {
    fontSize: 'clamp(1.35rem, 2.6vw, 1.75rem)',
    maxWidth: '16ch',
  },
  body: {
    color: t.brand.textSecondary,
    lineHeight: 1.55,
    fontSize: '0.92rem',
    maxWidth: '30ch',
    textAlign: 'center',
  },
  aboutText: {
    color: t.brand.textSecondary,
    lineHeight: 1.6,
    fontSize: '0.95rem',
    maxWidth: '46ch',
    textAlign: 'center',
    justifySelf: 'center',
  },
  legalRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '4px',
    color: t.brand.textTertiary,
    fontSize: '0.78rem',
  },
  legalLink: {
    color: t.brand.textTertiary,
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  actionStack: {
    display: 'grid',
    gap: '10px',
    width: '100%',
  },
  buttonBase: {
    minHeight: '48px',
    width: '100%',
    borderRadius: t.radius.md,
    fontFamily: t.font.display,
    fontWeight: '600',
    fontSize: '0.95rem',
    letterSpacing: '-0.01em',
    paddingInline: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition:
      'box-shadow 180ms ease, background 180ms ease, border-color 180ms ease, transform 180ms ease',
  },
  primaryButton: {
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    border: `1px solid ${t.brand.ink}`,
    boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 6px 18px rgba(0,0,0,0.16)',
    ':hover': {
      backgroundColor: t.brand.inkSoft,
      color: t.brand.onInk,
      border: `1px solid ${t.brand.inkSoft}`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.14), 0 10px 24px rgba(0,0,0,0.2)',
    },
    ':active': {
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)',
    },
  },
  secondaryButton: {
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    border: `1px solid ${t.brand.line}`,
    boxShadow: t.surface.raisedShadow,
    ':hover': {
      backgroundColor: t.brand.surfaceMuted,
      border: `1px solid ${t.brand.inkMuted}`,
      boxShadow: t.surface.hoverShadow,
    },
    ':active': {
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.08)',
    },
  },
  buttonContent: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
  },
  helperNote: {
    color: t.brand.textSecondary,
    fontSize: '0.82rem',
    lineHeight: 1.5,
    maxWidth: '30ch',
    textAlign: 'center',
    justifySelf: 'center',
  },
  errorText: {
    color: t.status.criticalFg,
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
            <img
              src="/wulo-logo.png?v=2"
              alt="Wulo logo"
              className={styles.brandMark}
            />
          </span>
          <div className={styles.brandLockup}>
            <Text className={styles.brandMeta}>{APP_RELEASE_LABEL}</Text>
            <Text className={styles.brandName}>{APP_TITLE}</Text>
          </div>
        </div>

        {status === 'loading' ? (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={mergeClasses(styles.title, styles.loadingTitle)}>
              Checking your secure session
            </Text>
            <Text className={styles.body}>
              Loading your learning workspace and verifying your sign-in state.
            </Text>
            <Spinner size="large" />
          </>
        ) : status === 'error' ? (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={styles.title}>
              Your session could not be loaded
            </Text>
            <Text className={styles.body}>
              Retry the session check or sign in again.
            </Text>
            {error ? <Text className={styles.errorText}>{error}</Text> : null}
            <div className={styles.actionStack}>
              <button
                type="button"
                className={mergeClasses(
                  styles.buttonBase,
                  styles.primaryButton
                )}
                onClick={onRetry}
              >
                Retry session
              </button>
            </div>
          </>
        ) : (
          <>
            <Text className={styles.eyebrow}>Welcome back</Text>
            <Text className={styles.title}>Let’s help you get there — intelligently</Text>

            <Text className={styles.aboutText}>
              Practise past questions and pass WAEC, NECO, JAMB & JSSCE with an
              AI tutor.
            </Text>

            {isLocalAuthOrigin() ? (
              <div className={styles.actionStack}>
                <Text className={styles.body}>
                  Local development is running without Azure Easy Auth. Restart
                  the backend with local auth enabled, then recheck the session.
                </Text>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.buttonBase,
                    styles.primaryButton
                  )}
                  onClick={onRetry}
                >
                  Recheck session
                </button>
              </div>
            ) : (
              <div className={styles.actionStack}>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.buttonBase,
                    styles.secondaryButton
                  )}
                  onClick={onGoogleSignIn}
                >
                  <span className={styles.buttonContent}>
                    <GoogleIcon />
                    <span>Continue with Google</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.buttonBase,
                    styles.primaryButton
                  )}
                  onClick={onMicrosoftSignIn}
                >
                  <span className={styles.buttonContent}>
                    <MicrosoftIcon />
                    <span>Continue with Microsoft</span>
                  </span>
                </button>
                <Text className={styles.helperNote}>
                  New here? Sign in to create your account.
                </Text>
              </div>
            )}

            <div className={styles.legalRow}>
              <a className={styles.legalLink} href="/privacy">
                Privacy
              </a>
              <span aria-hidden="true">·</span>
              <a className={styles.legalLink} href="/terms">
                Terms
              </a>
              <span aria-hidden="true">·</span>
              <a className={styles.legalLink} href="/ai-transparency">
                How we use AI
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
