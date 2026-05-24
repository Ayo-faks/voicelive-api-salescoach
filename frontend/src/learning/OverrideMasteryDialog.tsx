import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import type { StudentProfileSkill } from './api'

const useStyles = makeStyles({
  body: {
    display: 'grid',
    gap: '14px',
  },
  metricRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 96px',
    gap: '10px',
    alignItems: 'center',
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: 600,
  },
  rangeInput: {
    width: '100%',
    accentColor: tokens.colorBrandBackground,
  },
})

export type OverrideMasteryDialogProps = {
  open: boolean
  studentId: string
  skill: StudentProfileSkill | null
  onClose: () => void
  onSubmit: (payload: {
    skill_id: string
    probability: number
    uncertainty: number
    reason: string
  }) => Promise<void>
}

export function OverrideMasteryDialog({
  open,
  studentId,
  skill,
  onClose,
  onSubmit,
}: OverrideMasteryDialogProps) {
  const styles = useStyles()
  const [probability, setProbability] = useState(skill?.probability ?? 0.5)
  const [uncertainty, setUncertainty] = useState(skill?.uncertainty ?? 0.1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !skill) return
    setProbability(skill.probability)
    setUncertainty(skill.uncertainty || 0.1)
    setReason('')
    setError(null)
  }, [open, skill])

  const probabilityValid = probability >= 0 && probability <= 1
  const uncertaintyValid = uncertainty >= 0 && uncertainty <= 1
  const reasonValid = reason.trim().length >= 5
  const canSubmit = Boolean(skill) && probabilityValid && uncertaintyValid && reasonValid && !busy

  async function handleSubmit() {
    if (!skill || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        skill_id: skill.skill_id,
        probability,
        uncertainty,
        reason: reason.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface aria-label="Override mastery dialog">
        <DialogTitle>Override mastery</DialogTitle>
        <DialogBody className={styles.body}>
          <Text size={200}>
            {skill
              ? `${studentId} · ${skill.skill_label} (${skill.skill_id})`
              : 'Select a skill to override'}
          </Text>

          <Field label={`Probability (${Math.round(probability * 100)}%)`} validationState={probabilityValid ? 'none' : 'error'}>
            <div className={styles.metricRow}>
              <input
                className={styles.rangeInput}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={probability}
                aria-label="Probability"
                onChange={event => setProbability(Number(event.currentTarget.value))}
              />
              <Input
                aria-label="Probability value"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={String(probability)}
                onChange={(_, data) => setProbability(Number(data.value))}
              />
            </div>
          </Field>

          <Field label={`Uncertainty (${Math.round(uncertainty * 100)}%)`} validationState={uncertaintyValid ? 'none' : 'error'}>
            <div className={styles.metricRow}>
              <input
                className={styles.rangeInput}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={uncertainty}
                aria-label="Uncertainty"
                onChange={event => setUncertainty(Number(event.currentTarget.value))}
              />
              <Input
                aria-label="Uncertainty value"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={String(uncertainty)}
                onChange={(_, data) => setUncertainty(Number(data.value))}
              />
            </div>
          </Field>

          <Field label="Reason" required validationState={reasonValid || reason.length === 0 ? 'none' : 'error'}>
            <Textarea
              aria-label="Override reason"
              value={reason}
              onChange={(_, data) => setReason(data.value)}
              placeholder="Evidence for this teacher override"
            />
          </Field>

          {error ? <Text className={styles.error}>{error}</Text> : null}
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Save override'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  )
}
