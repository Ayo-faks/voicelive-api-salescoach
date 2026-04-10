import { useState, useCallback } from 'react'
import { Button, Input, Text, makeStyles, tokens } from '@fluentui/react-components'
import { api } from '../services/api'
import type { AuthSession } from '../services/api'

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '24px',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '400px',
    width: '100%',
    padding: '32px',
    borderRadius: '12px',
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow16,
    textAlign: 'center',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
  },
  description: {
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.5',
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: '14px',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
  },
  signOutLink: {
    marginTop: '8px',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    fontSize: '13px',
    '&:hover': {
      color: tokens.colorNeutralForeground2,
    },
  },
})

interface InviteCodeScreenProps {
  onSuccess: (session: AuthSession) => void
  onSignOut: () => void
}

export function InviteCodeScreen({ onSuccess, onSignOut }: InviteCodeScreenProps) {
  const styles = useStyles()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    try {
      const session = await api.claimInviteCode(code.trim())
      onSuccess(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid invite code')
    } finally {
      setLoading(false)
    }
  }, [code, onSuccess])

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <Text className={styles.title}>Welcome to Wulo</Text>
        <Text className={styles.description}>
          To get started as a therapist, please enter the invite code you received.
          If you don&apos;t have one, contact your administrator.
        </Text>
        <div className={styles.inputRow}>
          <Input
            placeholder="Enter invite code"
            value={code}
            onChange={(_, data) => setCode(data.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSubmit() }}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <Button
            appearance="primary"
            onClick={() => void handleSubmit()}
            disabled={!code.trim() || loading}
          >
            {loading ? 'Verifying...' : 'Submit'}
          </Button>
        </div>
        {error && <Text className={styles.error}>{error}</Text>}
        <Text className={styles.signOutLink} onClick={onSignOut}>
          Sign out
        </Text>
      </div>
    </div>
  )
}
