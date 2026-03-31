import { Button, Spinner, Text, makeStyles } from '@fluentui/react-components'
import { useEffect, useState } from 'react'

const useStyles = makeStyles({
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 'var(--space-lg)',
    background:
      'radial-gradient(circle at 12% 14%, rgba(13, 138, 132, 0.16), transparent 20%), radial-gradient(circle at 86% 82%, rgba(13, 138, 132, 0.12), transparent 22%), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.72), rgba(241, 247, 246, 0.92) 48%, #eef5f3 100%)',
  },
  card: {
    width: 'min(372px, 100%)',
    borderRadius: '24px',
    border: '1px solid rgba(17, 36, 58, 0.08)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))',
    boxShadow: '0 32px 80px rgba(17, 36, 58, 0.12)',
    padding: '32px 28px 26px',
    display: 'grid',
    gap: '18px',
    justifyItems: 'center',
    textAlign: 'center',
    backdropFilter: 'blur(14px)',
  },
  brandRow: {
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
    gap: '8px',
  },
  brandMark: {
    width: '30px',
    height: '30px',
    objectFit: 'contain',
  },
  brandName: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.08rem',
    fontWeight: '800',
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.03em',
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
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
    fontSize: '0.92rem',
    maxWidth: '28ch',
    textAlign: 'center',
  },
  buttonBase: {
    minHeight: '46px',
    width: '100%',
    borderRadius: '4px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.95rem',
    paddingInline: '16px',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
  },
})

export function LogoutScreen() {
  const styles = useStyles()
  const [phase, setPhase] = useState<'signing-out' | 'done'>('signing-out')

  useEffect(() => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = '/.auth/logout'
    iframe.onload = () => {
      setTimeout(() => {
        setPhase('done')
        iframe.remove()
      }, 600)
    }
    iframe.onerror = () => {
      setPhase('done')
      iframe.remove()
    }
    document.body.appendChild(iframe)
    return () => { iframe.remove() }
  }, [])

  return (
    <div className={styles.shell}>
      <section className={styles.card}>
        <div className={styles.brandRow}>
          <img src="/wulo-logo.png" alt="Wulo logo" className={styles.brandMark} />
          <Text className={styles.brandName}>Wulo</Text>
        </div>

        {phase === 'signing-out' ? (
          <>
            <Text className={styles.eyebrow}>See you soon</Text>
            <Text className={styles.title}>Signing you out</Text>
            <Text className={styles.body}>Clearing your session securely.</Text>
            <Spinner size="large" />
          </>
        ) : (
          <>
            <Text className={styles.eyebrow}>See you soon</Text>
            <Text className={styles.title}>You've been signed out</Text>
            <Text className={styles.body}>Your session has been cleared. Sign in again to continue practicing.</Text>
            <Button
              className={`${styles.buttonBase} ${styles.primaryButton}`}
              onClick={() => { window.location.href = '/' }}
            >
              Return to Wulo
            </Button>
          </>
        )}
      </section>
    </div>
  )
}
