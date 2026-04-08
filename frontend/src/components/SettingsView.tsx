/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Dropdown,
  Field,
  Input,
  Option,
  Textarea,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { useRef, useState } from 'react'
import { AVATAR_OPTIONS, type ChildInvitation, type ChildProfile, type InvitationEmailDelivery } from '../types'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  hero: {
    display: 'grid',
    gap: 'var(--space-sm)',
    padding: 'clamp(1.1rem, 2.4vw, 1.5rem)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at top right, rgba(32, 163, 158, 0.18), transparent 34%), linear-gradient(135deg, rgba(235, 247, 246, 0.98), rgba(224, 241, 239, 0.98))',
  },
  heroCopy: {
    display: 'grid',
    gap: '6px',
    maxWidth: '52ch',
  },
  eyebrow: {
    color: 'var(--color-primary-light)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
    fontWeight: '800',
    letterSpacing: '-0.05em',
    lineHeight: 1.02,
  },
  copy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.88rem',
    lineHeight: 1.5,
    maxWidth: '50ch',
  },
  summaryBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  summaryPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '32px',
    paddingInline: '12px',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
  },
  summaryValue: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  sectionGrid: {
    display: 'grid',
    gap: 'var(--space-md)',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    display: 'grid',
    gap: 'var(--space-md)',
    padding: 'var(--space-lg)',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.05rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  controlsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  controlBlock: {
    display: 'grid',
    gap: '6px',
    padding: 'var(--space-md)',
    border: '1px solid rgba(15, 42, 58, 0.08)',
    backgroundColor: 'rgba(248, 252, 251, 0.92)',
  },
  label: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  dropdown: {
    minWidth: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  modeToggleRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  modeButton: {
    minHeight: '38px',
    paddingInline: '14px',
    borderRadius: '999px',
    border: '1px solid rgba(13, 138, 132, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    color: 'var(--color-text-secondary)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  modeButtonActive: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: '1px solid var(--color-primary)',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.45,
  },
  form: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  list: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  listItem: {
    display: 'grid',
    gap: '10px',
    padding: 'var(--space-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(248, 252, 251, 0.92)',
  },
  listItemHighlighted: {
    border: '1px solid var(--color-primary)',
    boxShadow: '0 0 0 1px rgba(13, 138, 132, 0.18)',
    backgroundColor: 'rgba(223, 245, 241, 0.96)',
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    alignItems: 'flex-start',
  },
  listTitle: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
  },
  listMeta: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.4,
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  emptyState: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.82rem',
    lineHeight: 1.45,
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    alignItems: 'center',
  },
  statusText: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: '700',
  },
  metricRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: 'var(--space-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    backgroundColor: 'rgba(32, 163, 158, 0.08)',
    '@media (max-width: 720px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
    },
  },
  metricValue: {
    color: 'var(--color-primary-light)',
    fontFamily: 'var(--font-display)',
    fontWeight: '800',
    letterSpacing: '-0.02em',
  },
  supportCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.55,
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    width: 'fit-content',
    padding: '6px 10px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '700',
  },
  statusPillSuccess: {
    border: '1px solid rgba(13, 138, 132, 0.24)',
    color: 'var(--color-primary-dark)',
    backgroundColor: 'rgba(223, 245, 241, 0.92)',
  },
  statusPillWarning: {
    border: '1px solid rgba(191, 109, 0, 0.24)',
    color: '#8a4b00',
    backgroundColor: 'rgba(255, 243, 221, 0.95)',
  },
  statusPillError: {
    border: '1px solid rgba(170, 26, 23, 0.24)',
    color: '#a11a17',
    backgroundColor: 'rgba(255, 235, 233, 0.95)',
  },
})

function getInvitationDeliveryCopy(delivery?: InvitationEmailDelivery | null) {
  if (!delivery) {
    return null
  }

  if (delivery.delivered) {
    return {
      label: 'Email sent',
      detail: delivery.provider_message_id
        ? `Delivery queued successfully. Message ID ${delivery.provider_message_id}.`
        : 'Delivery queued successfully.',
      tone: 'success' as const,
    }
  }

  if (delivery.status === 'not_configured') {
    return {
      label: 'Email not configured',
      detail: delivery.error || 'The invitation exists, but outbound email is not configured yet.',
      tone: 'warning' as const,
    }
  }

  return {
    label: 'Email delivery failed',
    detail: delivery.error || 'The invitation exists, but the email could not be sent.',
    tone: 'error' as const,
  }
}

interface SettingsViewProps {
  isTherapist: boolean
  canManageChildren: boolean
  currentMode: 'workspace' | 'child'
  authRole?: string | null
  selectedChild: ChildProfile | null
  childProfiles: ChildProfile[]
  childProfileSaving: boolean
  incomingInvitations: ChildInvitation[]
  sentInvitations: ChildInvitation[]
  highlightedInvitationId?: string | null
  invitationDeliveryById?: Record<string, InvitationEmailDelivery | null | undefined>
  invitationsLoading: boolean
  invitationError?: string | null
  invitationActionPendingId?: string | null
  selectedAvatar: string
  onChooseMode: (mode: 'workspace' | 'child') => void
  onSelectChild: (childId: string) => void
  onSelectAvatar: (avatarValue: string) => void
  onCreateChild: (payload: { name: string; date_of_birth?: string; notes?: string }) => Promise<unknown>
  onInviteParent: (payload: { child_id: string; invited_email: string }) => Promise<unknown>
  onAcceptInvitation: (invitationId: string) => Promise<unknown>
  onDeclineInvitation: (invitationId: string) => Promise<unknown>
  onRevokeInvitation: (invitationId: string) => Promise<unknown>
  onResendInvitation: (invitationId: string) => Promise<unknown>
}

export function SettingsView({
  isTherapist,
  canManageChildren,
  currentMode,
  authRole,
  selectedChild,
  childProfiles,
  childProfileSaving,
  incomingInvitations,
  sentInvitations,
  highlightedInvitationId,
  invitationDeliveryById = {},
  invitationsLoading,
  invitationError,
  invitationActionPendingId,
  selectedAvatar,
  onChooseMode,
  onSelectChild,
  onSelectAvatar,
  onCreateChild,
  onInviteParent,
  onAcceptInvitation,
  onDeclineInvitation,
  onRevokeInvitation,
  onResendInvitation,
}: SettingsViewProps) {
  const styles = useStyles()
  const [newChildName, setNewChildName] = useState('')
  const [newChildDob, setNewChildDob] = useState('')
  const [newChildNotes, setNewChildNotes] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [childFormError, setChildFormError] = useState<string | null>(null)
  const invitationRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const roleLabel = authRole || 'Unknown role'
  const modeLabel = currentMode === 'child' ? 'Child practice view' : 'Workspace view'
  const childLabel = selectedChild?.name || 'No child selected'
  const avatarLabel = AVATAR_OPTIONS.find(option => option.value === selectedAvatar)?.label || 'Practice buddy'
  const toolAccessLabel = currentMode === 'child'
    ? 'Child-safe practice view active'
    : isTherapist
      ? 'Therapist review and planning tools available'
      : 'Practice workspace ready'

  const handleCreateChild = async () => {
    const normalizedName = newChildName.trim()
    if (!normalizedName) {
      setChildFormError('Child name is required.')
      return
    }

    setChildFormError(null)
    try {
      await onCreateChild({
        name: normalizedName,
        date_of_birth: newChildDob || undefined,
        notes: newChildNotes.trim() || undefined,
      })
      setNewChildName('')
      setNewChildDob('')
      setNewChildNotes('')
    } catch (error) {
      setChildFormError(error instanceof Error ? error.message : 'Child profile could not be created right now.')
    }
  }

  const handleInviteParent = async () => {
    if (!selectedChild?.id) {
      return
    }

    const normalizedEmail = inviteEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      return
    }

    try {
      await onInviteParent({
        child_id: selectedChild.id,
        invited_email: normalizedEmail,
      })
      setInviteEmail('')
    } catch {
      return
    }
  }

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <div className={styles.heroCopy}>
          <Text className={styles.eyebrow}>Workspace</Text>
          <Text className={styles.title}>Adjust your current practice setup.</Text>
          <Text className={styles.copy}>
            Use this page for quick environment changes: switch mode, pick the active child, and choose the current practice buddy.
          </Text>
        </div>
        <div className={styles.summaryBar}>
          <div className={styles.summaryPill}>
            Role: <span className={styles.summaryValue}>{roleLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Mode: <span className={styles.summaryValue}>{modeLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Child: <span className={styles.summaryValue}>{childLabel}</span>
          </div>
          <div className={styles.summaryPill}>
            Buddy: <span className={styles.summaryValue}>{avatarLabel}</span>
          </div>
        </div>
      </Card>

      <div className={styles.grid}>
        <Card className={styles.card}>
          <Text className={styles.cardTitle}>Workspace controls</Text>
          <div className={styles.controlsGrid}>
            <div className={styles.controlBlock}>
              <Text className={styles.label}>Mode</Text>
              <div className={styles.modeToggleRow}>
                <Button
                  appearance="secondary"
                  className={mergeClasses(styles.modeButton, currentMode === 'child' && styles.modeButtonActive)}
                  onClick={() => onChooseMode('child')}
                >
                  Child mode
                </Button>
                <Button
                  appearance="secondary"
                  className={mergeClasses(styles.modeButton, currentMode === 'workspace' && styles.modeButtonActive)}
                  onClick={() => onChooseMode('workspace')}
                >
                  Workspace view
                </Button>
              </div>
              <Text className={styles.helperText}>
                Child practice view keeps the shared-device surface simple. Workspace view returns you to the adult setup and management tools.
              </Text>
            </div>

            <div className={styles.controlBlock}>
              <Text className={styles.label}>Active child</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={!canManageChildren || childProfiles.length === 0}
                placeholder={childProfiles.length > 0 ? 'Select child' : 'No child profiles'}
                selectedOptions={selectedChild ? [selectedChild.id] : []}
                value={selectedChild?.name}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectChild(data.optionValue)
                  }
                }}
              >
                {childProfiles.map(child => (
                  <Option key={child.id} value={child.id} text={child.name}>
                    {child.name}
                  </Option>
                ))}
              </Dropdown>
              <Text className={styles.helperText}>
                This child becomes the active context for home and dashboard tools.
              </Text>
            </div>

            <div className={styles.controlBlock}>
              <Text className={styles.label}>Practice buddy</Text>
              <Dropdown
                className={styles.dropdown}
                selectedOptions={[selectedAvatar]}
                value={avatarLabel}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectAvatar(data.optionValue)
                  }
                }}
              >
                {AVATAR_OPTIONS.map(option => (
                  <Option key={option.value} value={option.value} text={option.label}>
                    {option.label}
                  </Option>
                ))}
              </Dropdown>
              <Text className={styles.helperText}>
                Sets the current buddy used when launching a session.
              </Text>
            </div>
          </div>
          <div className={styles.metricRow}>
            <Text className={styles.label}>Workspace status</Text>
            <Text className={styles.metricValue}>{toolAccessLabel}</Text>
          </div>
        </Card>

        <div className={styles.sectionGrid}>
          <Card className={styles.card}>
            <Text className={styles.cardTitle}>Child profiles</Text>
            <div className={styles.form}>
              <Field label="Child name" validationMessage={childFormError || undefined}>
                <Input value={newChildName} onChange={(_, data) => setNewChildName(data.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={newChildDob} onChange={(_, data) => setNewChildDob(data.value)} />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={newChildNotes}
                  onChange={(_, data) => setNewChildNotes(data.value)}
                  resize="vertical"
                />
              </Field>
              <div className={styles.buttonRow}>
                <Button appearance="primary" onClick={() => void handleCreateChild()} disabled={childProfileSaving}>
                  {childProfileSaving ? 'Saving child...' : 'Add child profile'}
                </Button>
              </div>
              <Text className={styles.helperText}>
                Child creation is now explicit. New profiles appear only for the family or therapist relationship that owns them.
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <Text className={styles.cardTitle}>Parent invitations</Text>
            {isTherapist ? (
              <div className={styles.form}>
                <Field label="Invite parent by email">
                  <Input value={inviteEmail} onChange={(_, data) => setInviteEmail(data.value)} />
                </Field>
                <div className={styles.buttonRow}>
                  <Button
                    appearance="primary"
                    onClick={() => void handleInviteParent()}
                    disabled={!selectedChild || !inviteEmail.trim() || invitationActionPendingId === `create:${selectedChild?.id}`}
                  >
                    {invitationActionPendingId === `create:${selectedChild?.id}` ? 'Sending invite...' : 'Send parent invite'}
                  </Button>
                </div>
                <Text className={styles.helperText}>
                  Invitations are scoped to the active child. The invited parent can accept from the same workspace after sign-in.
                </Text>
              </div>
            ) : (
              <Text className={styles.helperText}>
                Incoming parent invites appear here when a therapist links you to a child profile.
              </Text>
            )}

            {invitationError ? <Text className={styles.helperText}>{invitationError}</Text> : null}

            <div className={styles.list}>
              <div className={styles.statusRow}>
                <Text className={styles.statusText}>Incoming invites</Text>
                <Text className={styles.listMeta}>{invitationsLoading ? 'Loading...' : `${incomingInvitations.length}`}</Text>
              </div>
              {incomingInvitations.length === 0 ? (
                <Text className={styles.emptyState}>No incoming invites right now.</Text>
              ) : (
                incomingInvitations.map(invitation => (
                  <div
                    key={invitation.id}
                    ref={element => {
                      invitationRefs.current[invitation.id] = element
                      if (element && typeof element.scrollIntoView === 'function' && highlightedInvitationId === invitation.id) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                    }}
                    className={mergeClasses(
                      styles.listItem,
                      highlightedInvitationId === invitation.id && styles.listItemHighlighted,
                    )}
                  >
                    <div className={styles.listHeader}>
                      <Text className={styles.listTitle}>{invitation.child_name}</Text>
                      <Text className={styles.listMeta}>{invitation.status}</Text>
                    </div>
                    {highlightedInvitationId === invitation.id ? (
                      <Text className={styles.listMeta}>Linked from your invitation email.</Text>
                    ) : null}
                    <Text className={styles.listMeta}>From {invitation.invited_by_name || 'Therapist'} for {invitation.relationship} access.</Text>
                    <Text className={styles.listMeta}>
                      {invitation.expires_at ? `Expires ${new Date(invitation.expires_at).toLocaleString()}` : 'No expiration set'}
                    </Text>
                    {invitation.status === 'pending' ? (
                      <div className={styles.buttonRow}>
                        <Button
                          appearance="primary"
                            onClick={() => {
                              void onAcceptInvitation(invitation.id).catch(() => undefined)
                            }}
                          disabled={invitationActionPendingId === invitation.id}
                        >
                          Accept
                        </Button>
                        <Button
                          appearance="secondary"
                            onClick={() => {
                              void onDeclineInvitation(invitation.id).catch(() => undefined)
                            }}
                          disabled={invitationActionPendingId === invitation.id}
                        >
                          Decline
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {isTherapist ? (
              <div className={styles.list}>
                <div className={styles.statusRow}>
                  <Text className={styles.statusText}>Sent invites</Text>
                  <Text className={styles.listMeta}>{invitationsLoading ? 'Loading...' : `${sentInvitations.length}`}</Text>
                </div>
                {sentInvitations.length === 0 ? (
                  <Text className={styles.emptyState}>No therapist invites sent yet.</Text>
                ) : (
                  sentInvitations.map(invitation => (
                    <div
                      key={invitation.id}
                      ref={element => {
                        invitationRefs.current[invitation.id] = element
                        if (element && typeof element.scrollIntoView === 'function' && highlightedInvitationId === invitation.id) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                      }}
                      className={mergeClasses(
                        styles.listItem,
                        highlightedInvitationId === invitation.id && styles.listItemHighlighted,
                      )}
                    >
                      <div className={styles.listHeader}>
                        <Text className={styles.listTitle}>{invitation.child_name}</Text>
                        <Text className={styles.listMeta}>{invitation.status}</Text>
                      </div>
                      <Text className={styles.listMeta}>{invitation.invited_email}</Text>
                      {(() => {
                        const deliveryCopy = getInvitationDeliveryCopy(
                          invitationDeliveryById[invitation.id] ?? invitation.email_delivery ?? null,
                        )

                        if (!deliveryCopy) {
                          return null
                        }

                        return (
                          <>
                            <Text
                              className={mergeClasses(
                                styles.statusPill,
                                deliveryCopy.tone === 'success' && styles.statusPillSuccess,
                                deliveryCopy.tone === 'warning' && styles.statusPillWarning,
                                deliveryCopy.tone === 'error' && styles.statusPillError,
                              )}
                            >
                              {deliveryCopy.label}
                            </Text>
                            <Text className={styles.listMeta}>{deliveryCopy.detail}</Text>
                          </>
                        )
                      })()}
                      <Text className={styles.listMeta}>
                        {invitation.expires_at ? `Expires ${new Date(invitation.expires_at).toLocaleString()}` : 'No expiration set'}
                      </Text>
                      {invitation.status === 'pending' ? (
                        <div className={styles.buttonRow}>
                          <Button
                            appearance="secondary"
                            onClick={() => {
                              void onRevokeInvitation(invitation.id).catch(() => undefined)
                            }}
                            disabled={invitationActionPendingId === invitation.id}
                          >
                            Revoke
                          </Button>
                          <Button
                            appearance="secondary"
                            onClick={() => {
                              void onResendInvitation(invitation.id).catch(() => undefined)
                            }}
                            disabled={invitationActionPendingId === invitation.id}
                          >
                            Resend
                          </Button>
                        </div>
                      ) : invitation.status === 'expired' || invitation.status === 'declined' || invitation.status === 'revoked' ? (
                        <div className={styles.buttonRow}>
                          <Button
                            appearance="secondary"
                            onClick={() => {
                              void onResendInvitation(invitation.id).catch(() => undefined)
                            }}
                            disabled={invitationActionPendingId === invitation.id}
                          >
                            Resend
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}