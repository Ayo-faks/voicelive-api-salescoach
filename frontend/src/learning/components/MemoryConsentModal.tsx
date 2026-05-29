import { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { setMemoryConsent } from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const useStyles = makeStyles({
  body: {
    display: 'grid',
    gap: '10px',
    fontSize: '0.92rem',
    color: t.brand.text,
    lineHeight: 1.5,
  },
  hint: {
    fontSize: '0.82rem',
    color: t.brand.textSecondary,
  },
})

export interface MemoryConsentModalProps {
  open: boolean
  learnerId: string
  onClose: (accepted: boolean) => void
}

export function MemoryConsentModal({
  open,
  learnerId,
  onClose,
}: MemoryConsentModalProps) {
  const styles = useStyles()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (acceptedNow: boolean) => {
    setBusy(true)
    try {
      await setMemoryConsent({ learner_id: learnerId, accepted: acceptedNow })
      onClose(acceptedNow)
    } catch {
      // surface failures via the panel's error UI on next load
      onClose(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      modalType="modal"
      open={open}
      onOpenChange={(_e, data) => {
        if (!data.open) onClose(false)
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Remember a few things about you?</DialogTitle>
          <DialogContent>
            <div className={styles.body}>
              <Text>
                I can remember a small set of things — your subjects, exam
                goals, study schedule and how you're feeling today — so I can
                tailor lessons to you.
              </Text>
              <Text className={styles.hint}>
                I never store names, contact details or anything sensitive.
                You can see and delete everything in the "What I remember
                about you" panel. Moods are forgotten after 3 days.
              </Text>
              <Checkbox
                checked={accepted}
                label="Yes, remember these things to help me learn"
                onChange={(_e, data) => setAccepted(Boolean(data.checked))}
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              Not now
            </Button>
            <Button
              appearance="primary"
              disabled={!accepted || busy}
              onClick={() => void submit(true)}
            >
              Turn on memory
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

export default MemoryConsentModal
