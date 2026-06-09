import {
  Caption1,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Text,
  Textarea,
  makeStyles,
} from '@fluentui/react-components'
import { useEffect, useRef, useState } from 'react'
import type { StudentProfileSkill } from './api'
import { pathfinderTokens as t } from './theme/pathfinder-tokens'

type OriginalEstimate = {
  skillId: string
  probability: number
  uncertainty: number
}

const useStyles = makeStyles({
  surface: {
    maxWidth: '560px',
    width: '100%',
    borderRadius: t.radius.lg,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-hover)',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: '1.18rem',
    fontWeight: 800,
    color: 'var(--pf-text)',
  },
  body: {
    display: 'grid',
    gap: '16px',
    width: '100%',
  },
  metricRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 96px',
    gap: '10px',
    alignItems: 'center',
  },
  error: {
    color: 'var(--pf-status-critical-fg)',
    fontWeight: 600,
  },
  metricCaption: {
    color: 'var(--pf-text-secondary)',
    fontWeight: 700,
  },
  fieldHelp: {
    color: 'var(--pf-text-tertiary)',
    display: 'block',
    marginTop: '-4px',
  },
  intro: {
    padding: '12px 14px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    lineHeight: '20px',
  },
  rangeInput: {
    width: '100%',
    accentColor: 'var(--pf-ink)',
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '2px',
  },
  primaryButton: {
    appearance: 'none',
    minHeight: '36px',
    paddingRight: '16px',
    paddingLeft: '16px',
    borderRadius: t.radius.pill,
    border: `1px solid var(--pf-ink)`,
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 800,
    lineHeight: 1,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  secondaryButton: {
    appearance: 'none',
    minHeight: '36px',
    paddingRight: '16px',
    paddingLeft: '16px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 800,
    lineHeight: 1,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
})

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function estimateCaption(original: number, current: number, noun: string) {
  const originalLabel = formatPercent(original)
  if (Math.abs(original - current) < 0.0001) {
    return `Current ${noun}: ${originalLabel} (unchanged)`
  }
  return `Current ${noun}: ${originalLabel} → adjusted value: ${formatPercent(current)}`
}

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
  studentId: _studentId,
  skill,
  onClose,
  onSubmit,
}: OverrideMasteryDialogProps) {
  const styles = useStyles()
  const [probability, setProbability] = useState(skill?.probability ?? 0.5)
  const [uncertainty, setUncertainty] = useState(skill?.uncertainty ?? 0.1)
  const [originalEstimate, setOriginalEstimate] =
    useState<OriginalEstimate | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openedSkillIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !skill) {
      openedSkillIdRef.current = null
      setOriginalEstimate(null)
      return
    }
    if (openedSkillIdRef.current === skill.skill_id) return
    openedSkillIdRef.current = skill.skill_id
    const nextUncertainty = skill.uncertainty ?? 0.1
    setProbability(skill.probability)
    setUncertainty(nextUncertainty)
    setOriginalEstimate({
      skillId: skill.skill_id,
      probability: skill.probability,
      uncertainty: nextUncertainty,
    })
    setReason('')
    setError(null)
  }, [open, skill])

  const probabilityValid = probability >= 0 && probability <= 1
  const uncertaintyValid = uncertainty >= 0 && uncertainty <= 1
  const reasonValid = reason.trim().length >= 5
  const canSubmit =
    Boolean(skill) &&
    probabilityValid &&
    uncertaintyValid &&
    reasonValid &&
    !busy
  const originalProbability = originalEstimate?.probability ?? probability
  const originalUncertainty = originalEstimate?.uncertainty ?? uncertainty

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
      <DialogSurface
        aria-label="Adjust mastery dialog"
        className={styles.surface}
      >
        <DialogBody>
          <DialogTitle className={styles.title}>Adjust mastery</DialogTitle>
          <DialogContent className={styles.body}>
            <Text size={200}>
              {skill
                ? `Learner profile · ${skill.skill_label}`
                : 'Select a skill to adjust'}
            </Text>

            <Text size={200} className={styles.intro}>
              Adjust the current estimate using your professional judgement. The
              sliders start at the latest values. Move them only when you have
              classroom evidence, then record why the adjustment is needed.
            </Text>

            <Caption1 className={styles.metricCaption}>
              {estimateCaption(originalProbability, probability, 'estimate')}
            </Caption1>
            <Field
              label={`Mastery (${Math.round(probability * 100)}%)`}
              hint="How likely the student has mastered this skill. 0% = not yet, 100% = secure."
              validationState={probabilityValid ? 'none' : 'error'}
            >
              <div className={styles.metricRow}>
                <input
                  className={styles.rangeInput}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={probability}
                  aria-label="Probability"
                  onChange={event =>
                    setProbability(Number(event.currentTarget.value))
                  }
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

            <Caption1 className={styles.metricCaption}>
              {estimateCaption(originalUncertainty, uncertainty, 'uncertainty')}
            </Caption1>
            <Field
              label={`Uncertainty (${Math.round(uncertainty * 100)}%)`}
              hint="How unsure you are. Lower = more confident. Raise this if you want Wulo Academy to keep checking."
              validationState={uncertaintyValid ? 'none' : 'error'}
            >
              <div className={styles.metricRow}>
                <input
                  className={styles.rangeInput}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={uncertainty}
                  aria-label="Uncertainty"
                  onChange={event =>
                    setUncertainty(Number(event.currentTarget.value))
                  }
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

            <Field
              label="Reason"
              required
              validationState={
                reasonValid || reason.length === 0 ? 'none' : 'error'
              }
            >
              <Textarea
                aria-label="Adjustment reason"
                value={reason}
                onChange={(_, data) => setReason(data.value)}
                placeholder="Why this adjustment is needed"
              />
            </Field>

            {error ? <Text className={styles.error}>{error}</Text> : null}
          </DialogContent>
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {busy ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
