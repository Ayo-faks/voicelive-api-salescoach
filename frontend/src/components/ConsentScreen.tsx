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

interface Props {
  open: boolean
  saving: boolean
  error: string | null
  onAccept: () => void
  onCancel: () => void
}

export function ConsentScreen({ open, saving, error, onAccept, onCancel }: Props) {
  const styles = useStyles()
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    if (open) {
      setAcknowledged(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>Supervised practice consent</DialogTitle>
        <DialogBody>
          <div className={styles.body}>
            <Text className={styles.helperText} size={300}>
              Before the first child session, please confirm that Wulo is being used for therapist-supervised speech practice.
            </Text>
            <div className={styles.acknowledgement}>
              <Text className={styles.helperText} size={300}>
                Practice feedback — not a clinical assessment.
              </Text>
              <Text className={styles.helperText} size={300}>
                This tool supports supervised practice only and should not be used for diagnosis or unsupervised decision-making.
              </Text>
              <Text className={styles.helperText} size={300}>
                By continuing, you confirm you have read our{' '}
                <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>,{' '}
                <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>, and{' '}
                <a href="/ai-transparency" target="_blank" rel="noreferrer">AI Transparency Notice</a>.
              </Text>
            </div>
            <Checkbox
              checked={acknowledged}
              label="I understand that Wulo is for supervised practice only and not diagnosis."
              onChange={(_, data) => setAcknowledged(Boolean(data.checked))}
            />
            {error ? <Text className={styles.errorText}>{error}</Text> : null}
          </div>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" className={styles.actionButton} onClick={onCancel}>
            Cancel
          </Button>
          <Button appearance="primary" className={mergeClasses(styles.actionButton, styles.primaryButton)} disabled={!acknowledged || saving} onClick={onAccept}>
            {saving ? 'Saving…' : 'Acknowledge and continue'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  )
}