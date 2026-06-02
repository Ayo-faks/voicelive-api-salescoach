/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { useEffect, useState } from 'react'

const useStyles = makeStyles({
  surface: {
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
  },
  body: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.875rem',
  },
  acknowledgement: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: '1px solid var(--color-border)',
  },
  errorText: {
    color: 'var(--color-error)',
    fontSize: '0.8125rem',
  },
  actionButton: {
    minHeight: '40px',
    minWidth: '160px',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.875rem',
  },
  primaryButton: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    boxShadow: 'none',
    border: 'none',
  },
})

type ConsentVariant = 'academy' | 'therapy'

interface Props {
  open: boolean
  saving: boolean
  error: string | null
  onAccept: () => void
  onCancel: () => void
  /** Branding/copy for the consent dialog. Defaults to the Wulo Academy study
   *  companion wording; 'therapy' preserves the legacy speech-practice copy. */
  variant?: ConsentVariant
}

const CONSENT_COPY: Record<
  ConsentVariant,
  {
    title: string
    intro: string
    acknowledgement: string
    detail: string
    checkbox: string
  }
> = {
  academy: {
    title: 'Welcome to Wulo Academy',
    intro:
      'Before your first session, please confirm how Wulo Academy works. ' +
      'It is a study companion for JSS1–SS3 learners preparing for WAEC, NECO, ' +
      'and JAMB — built for supervised practice, not formal assessment.',
    acknowledgement: 'Practice support — not a formal exam or grade.',
    detail:
      'Wulo Academy helps you revise and practise with an AI tutor. It does ' +
      'not replace your teacher, your school, or official examinations.',
    checkbox:
      'I understand that Wulo Academy is a study companion for supervised practice, not a formal assessment.',
  },
  therapy: {
    title: 'Supervised practice consent',
    intro:
      'Before the first child session, please confirm that Wulo is being used ' +
      'for therapist-supervised speech practice.',
    acknowledgement: 'Practice feedback — not a clinical assessment.',
    detail:
      'This tool supports supervised practice only and should not be used for ' +
      'diagnosis or unsupervised decision-making.',
    checkbox:
      'I understand that Wulo is for supervised practice only and not diagnosis.',
  },
}

export function ConsentScreen({
  open,
  saving,
  error,
  onAccept,
  onCancel,
  variant = 'academy',
}: Props) {
  const styles = useStyles()
  const [acknowledged, setAcknowledged] = useState(false)
  const copy = CONSENT_COPY[variant]

  useEffect(() => {
    if (open) {
      setAcknowledged(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogBody>
          <div className={styles.body}>
            <Text className={styles.helperText} size={300}>
              {copy.intro}
            </Text>
            <div className={styles.acknowledgement}>
              <Text className={styles.helperText} size={300}>
                {copy.acknowledgement}
              </Text>
              <Text className={styles.helperText} size={300}>
                {copy.detail}
              </Text>
              <Text className={styles.helperText} size={300}>
                By continuing, you confirm you have read our{' '}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>
                ,{' '}
                <a href="/terms" target="_blank" rel="noreferrer">
                  Terms of Service
                </a>
                , and{' '}
                <a href="/ai-transparency" target="_blank" rel="noreferrer">
                  AI Transparency Notice
                </a>
                .
              </Text>
            </div>
            <Checkbox
              checked={acknowledged}
              label={copy.checkbox}
              onChange={(_, data) => setAcknowledged(Boolean(data.checked))}
            />
            {error ? <Text className={styles.errorText}>{error}</Text> : null}
          </div>
        </DialogBody>
        <DialogActions>
          <Button
            appearance="secondary"
            className={styles.actionButton}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            appearance="primary"
            className={mergeClasses(styles.actionButton, styles.primaryButton)}
            disabled={!acknowledged || saving}
            onClick={onAccept}
          >
            {saving ? 'Saving…' : 'Acknowledge and continue'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  )
}
