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
  Field,
  Input,
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
    maxWidth: '520px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  dialogBody: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  body: {
    display: 'grid',
    gap: 'var(--space-md)',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
    paddingRight: 'var(--space-xs)',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.875rem',
  },
  fieldGroup: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  checkboxGroup: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: '1px solid var(--color-border)',
    display: 'grid',
    gap: 'var(--space-xs)',
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
  childName: string
  onSubmit: (data: {
    guardian_name: string
    guardian_email: string
    privacy_accepted: boolean
    terms_accepted: boolean
    ai_notice_accepted: boolean
    personal_data_consent_accepted: boolean
    special_category_consent_accepted: boolean
    parental_responsibility_confirmed: boolean
  }) => void
  onCancel: () => void
}

export function ParentalConsentDialog({ open, saving, error, childName, onSubmit, onCancel }: Props) {
  const styles = useStyles()
  const [guardianName, setGuardianName] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [aiNoticeAccepted, setAiNoticeAccepted] = useState(false)
  const [personalDataConsentAccepted, setPersonalDataConsentAccepted] = useState(false)
  const [specialCategoryConsentAccepted, setSpecialCategoryConsentAccepted] = useState(false)
  const [parentalResponsibilityConfirmed, setParentalResponsibilityConfirmed] = useState(false)

  useEffect(() => {
    if (open) {
      setGuardianName('')
      setGuardianEmail('')
      setPrivacyAccepted(false)
      setTermsAccepted(false)
      setAiNoticeAccepted(false)
      setPersonalDataConsentAccepted(false)
      setSpecialCategoryConsentAccepted(false)
      setParentalResponsibilityConfirmed(false)
    }
  }, [open])

  const documentsAccepted = privacyAccepted && termsAccepted && aiNoticeAccepted
  const gdprConsentsAccepted = personalDataConsentAccepted
    && specialCategoryConsentAccepted
    && parentalResponsibilityConfirmed
  const formValid = guardianName.trim() !== ''
    && guardianEmail.trim() !== ''
    && documentsAccepted
    && gdprConsentsAccepted

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>Parental consent for {childName}</DialogTitle>
        <DialogBody className={styles.dialogBody}>
          <div className={styles.body}>
            <Text className={styles.helperText} size={300}>
              Before starting practice sessions, parental or guardian consent must be recorded.
              Please enter the guardian's details, confirm review of the legal documents below,
              and record explicit GDPR consent for the child's data processing.
            </Text>

            <div className={styles.fieldGroup}>
              <Field label="Guardian name" required>
                <Input
                  value={guardianName}
                  onChange={(_, data) => setGuardianName(data.value)}
                  placeholder="Full name of parent or guardian"
                />
              </Field>
              <Field label="Guardian email" required>
                <Input
                  type="email"
                  value={guardianEmail}
                  onChange={(_, data) => setGuardianEmail(data.value)}
                  placeholder="email@example.com"
                />
              </Field>
            </div>

            <div className={styles.checkboxGroup}>
              <Text className={styles.helperText} size={300}>
                The guardian confirms they have read and accept:
              </Text>
              <Checkbox
                checked={privacyAccepted}
                label={
                  <span>
                    The <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
                  </span>
                }
                onChange={(_, data) => setPrivacyAccepted(Boolean(data.checked))}
              />
              <Checkbox
                checked={termsAccepted}
                label={
                  <span>
                    The <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>
                  </span>
                }
                onChange={(_, data) => setTermsAccepted(Boolean(data.checked))}
              />
              <Checkbox
                checked={aiNoticeAccepted}
                label={
                  <span>
                    The <a href="/ai-transparency" target="_blank" rel="noreferrer">AI Transparency Notice</a>
                  </span>
                }
                onChange={(_, data) => setAiNoticeAccepted(Boolean(data.checked))}
              />
            </div>

            <div className={styles.checkboxGroup}>
              <Text className={styles.helperText} size={300}>
                Personal data processing includes guardian contact details, the child's profile details,
                session records, transcripts, pronunciation assessments, therapist notes, consent records,
                and other information needed to provide and manage therapist-supervised speech practice.
              </Text>
              <Checkbox
                checked={personalDataConsentAccepted}
                label="I consent to Wulo processing my and my child's personal data to provide, manage, safeguard, and support therapist-supervised speech practice as described in the Privacy Policy."
                onChange={(_, data) => setPersonalDataConsentAccepted(Boolean(data.checked))}
              />
              <Text className={styles.helperText} size={300}>
                Special category data processing includes my child's speech audio, pronunciation assessments,
                AI-generated observations about speech and development, therapist notes about SEN needs,
                and related information revealing health or developmental characteristics.
              </Text>
              <Checkbox
                checked={specialCategoryConsentAccepted}
                label="I explicitly consent to Wulo processing my child's special category personal data for therapist-supervised speech practice, assessment, progress tracking, and care planning as described in the Privacy Policy."
                onChange={(_, data) => setSpecialCategoryConsentAccepted(Boolean(data.checked))}
              />
              <Checkbox
                checked={parentalResponsibilityConfirmed}
                label={`I confirm that I am the parent or legal guardian authorised to provide consent for ${childName}.`}
                onChange={(_, data) => setParentalResponsibilityConfirmed(Boolean(data.checked))}
              />
              <Text className={styles.helperText} size={300}>
                Consent can be withdrawn at any time. If consent is withdrawn, Wulo will stop the relevant
                processing and access to speech practice features may be affected.
              </Text>
            </div>

            {error ? <Text className={styles.errorText}>{error}</Text> : null}
          </div>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" className={styles.actionButton} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            className={mergeClasses(styles.actionButton, styles.primaryButton)}
            disabled={!formValid || saving}
            onClick={() => onSubmit({
              guardian_name: guardianName.trim(),
              guardian_email: guardianEmail.trim(),
              privacy_accepted: privacyAccepted,
              terms_accepted: termsAccepted,
              ai_notice_accepted: aiNoticeAccepted,
              personal_data_consent_accepted: personalDataConsentAccepted,
              special_category_consent_accepted: specialCategoryConsentAccepted,
              parental_responsibility_confirmed: parentalResponsibilityConfirmed,
            })}
          >
            {saving ? 'Saving…' : 'Record consent'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  )
}
