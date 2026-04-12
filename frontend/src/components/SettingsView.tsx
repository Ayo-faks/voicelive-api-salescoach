/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Textarea,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { useEffect, useRef, useState } from 'react'
import {
  AVATAR_OPTIONS,
  type ChildIntakeProposal,
  type ChildInvitation,
  type ChildProfile,
  type FamilyIntakeInvitation,
  type InvitationEmailDelivery,
  type WorkspaceSummary,
} from '../types'
import { api } from '../services/api'

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
  highlightedFamilyInvitationId?: string | null
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
  familyIntakeInvitations: FamilyIntakeInvitation[]
  incomingFamilyIntakeInvitations: FamilyIntakeInvitation[]
  pendingIncomingFamilyIntakeInvitations: FamilyIntakeInvitation[]
  sentFamilyIntakeInvitations: FamilyIntakeInvitation[]
  childIntakeProposals: ChildIntakeProposal[]
  pendingChildIntakeProposals: ChildIntakeProposal[]
  familyIntakeLoading: boolean
  familyIntakeError?: string | null
  familyIntakeActionPendingId?: string | null
  activeWorkspaceId?: string | null
  onCreateFamilyIntakeInvitation: (payload: { invited_email: string; workspace_id?: string }) => Promise<unknown>
  onAcceptFamilyIntakeInvitation: (invitationId: string) => Promise<unknown>
  onDeclineFamilyIntakeInvitation: (invitationId: string) => Promise<unknown>
  onSubmitChildIntakeProposals: (payload: {
    family_intake_invitation_id: string
    children: Array<{ child_name: string; date_of_birth?: string; notes?: string }>
  }) => Promise<unknown>
  onApproveChildIntakeProposal: (proposalId: string, reviewNote?: string) => Promise<unknown>
  onRejectChildIntakeProposal: (proposalId: string, reviewNote?: string) => Promise<unknown>
  onResubmitChildIntakeProposal: (payload: {
    proposalId: string
    child_name: string
    date_of_birth?: string
    notes?: string
  }) => Promise<unknown>
  userWorkspaces?: WorkspaceSummary[]
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
  highlightedFamilyInvitationId,
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
  familyIntakeInvitations,
  incomingFamilyIntakeInvitations,
  pendingIncomingFamilyIntakeInvitations,
  sentFamilyIntakeInvitations,
  childIntakeProposals,
  pendingChildIntakeProposals,
  familyIntakeLoading,
  familyIntakeError,
  familyIntakeActionPendingId,
  activeWorkspaceId,
  onCreateFamilyIntakeInvitation,
  onAcceptFamilyIntakeInvitation,
  onDeclineFamilyIntakeInvitation,
  onSubmitChildIntakeProposals,
  onApproveChildIntakeProposal,
  onRejectChildIntakeProposal,
  onResubmitChildIntakeProposal,
  userWorkspaces = [],
}: SettingsViewProps) {
  const styles = useStyles()
  const [newChildName, setNewChildName] = useState('')
  const [newChildDob, setNewChildDob] = useState('')
  const [newChildNotes, setNewChildNotes] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [familyInviteEmail, setFamilyInviteEmail] = useState('')
  const [childFormError, setChildFormError] = useState<string | null>(null)
  const [familyFormError, setFamilyFormError] = useState<string | null>(null)
  const [selectedFamilyInvitationId, setSelectedFamilyInvitationId] = useState<string | null>(null)
  const [familyChildrenDraft, setFamilyChildrenDraft] = useState<Array<{ key: string; child_name: string; date_of_birth: string; notes: string }>>([
    { key: 'draft-1', child_name: '', date_of_birth: '', notes: '' },
  ])
  const [editingRejectedProposalId, setEditingRejectedProposalId] = useState<string | null>(null)
  const [rejectedProposalName, setRejectedProposalName] = useState('')
  const [rejectedProposalDob, setRejectedProposalDob] = useState('')
  const [rejectedProposalNotes, setRejectedProposalNotes] = useState('')
  const [dataExporting, setDataExporting] = useState(false)
  const [dataDeleting, setDataDeleting] = useState(false)
  const [dataDeleteError, setDataDeleteError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const invitationRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const familyInvitationRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const roleLabel = authRole || 'Unknown role'
  const modeLabel = currentMode === 'child' ? 'Child practice view' : 'Workspace view'
  const childLabel = selectedChild?.name || 'No child selected'
  const avatarLabel = AVATAR_OPTIONS.find(option => option.value === selectedAvatar)?.label || 'Practice buddy'
  const toolAccessLabel = currentMode === 'child'
    ? 'Child-safe practice view active'
    : isTherapist
      ? 'Therapist review and planning tools available'
      : 'Practice workspace ready'
  const acceptedIncomingFamilyIntakeInvitations = incomingFamilyIntakeInvitations.filter(invitation => invitation.status === 'accepted')
  const selectedFamilyInvitation = acceptedIncomingFamilyIntakeInvitations.find(invitation => invitation.id === selectedFamilyInvitationId)
    || (highlightedFamilyInvitationId
      ? acceptedIncomingFamilyIntakeInvitations.find(invitation => invitation.id === highlightedFamilyInvitationId)
      : null)
    || acceptedIncomingFamilyIntakeInvitations[0]
    || null
  const proposalsForSelectedFamilyInvitation = selectedFamilyInvitation
    ? childIntakeProposals.filter(proposal => proposal.family_intake_invitation_id === selectedFamilyInvitation.id)
    : []
  const rejectedChildIntakeProposals = childIntakeProposals.filter(proposal => proposal.status === 'rejected')

  useEffect(() => {
    if (acceptedIncomingFamilyIntakeInvitations.length === 0) {
      setSelectedFamilyInvitationId(null)
      return
    }

    if (
      highlightedFamilyInvitationId &&
      acceptedIncomingFamilyIntakeInvitations.some(invitation => invitation.id === highlightedFamilyInvitationId) &&
      selectedFamilyInvitationId !== highlightedFamilyInvitationId
    ) {
      setSelectedFamilyInvitationId(highlightedFamilyInvitationId)
      return
    }

    if (!selectedFamilyInvitationId || !acceptedIncomingFamilyIntakeInvitations.some(invitation => invitation.id === selectedFamilyInvitationId)) {
      setSelectedFamilyInvitationId(acceptedIncomingFamilyIntakeInvitations[0].id)
    }
  }, [acceptedIncomingFamilyIntakeInvitations, highlightedFamilyInvitationId, selectedFamilyInvitationId])

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

  const handleCreateFamilyInvite = async () => {
    const normalizedEmail = familyInviteEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      setFamilyFormError('Parent or guardian email is required.')
      return
    }

    setFamilyFormError(null)
    try {
      await onCreateFamilyIntakeInvitation({
        invited_email: normalizedEmail,
        workspace_id: activeWorkspaceId || undefined,
      })
      setFamilyInviteEmail('')
    } catch (error) {
      setFamilyFormError(error instanceof Error ? error.message : 'Family intake invite could not be created right now.')
    }
  }

  const addFamilyChildDraft = () => {
    setFamilyChildrenDraft(current => [
      ...current,
      { key: `draft-${Date.now()}-${current.length}`, child_name: '', date_of_birth: '', notes: '' },
    ])
  }

  const updateFamilyChildDraft = (key: string, field: 'child_name' | 'date_of_birth' | 'notes', value: string) => {
    setFamilyChildrenDraft(current => current.map(item => (item.key === key ? { ...item, [field]: value } : item)))
  }

  const removeFamilyChildDraft = (key: string) => {
    setFamilyChildrenDraft(current => (current.length === 1 ? current : current.filter(item => item.key !== key)))
  }

  const handleSubmitFamilyChildren = async () => {
    if (!selectedFamilyInvitation) {
      setFamilyFormError('Accept a family invite before submitting children.')
      return
    }

    const normalizedChildren = familyChildrenDraft
      .map(item => ({
        child_name: item.child_name.trim(),
        date_of_birth: item.date_of_birth || undefined,
        notes: item.notes.trim() || undefined,
      }))
      .filter(item => item.child_name)

    if (normalizedChildren.length === 0) {
      setFamilyFormError('Add at least one child before submitting.')
      return
    }

    setFamilyFormError(null)
    try {
      await onSubmitChildIntakeProposals({
        family_intake_invitation_id: selectedFamilyInvitation.id,
        children: normalizedChildren,
      })
      setFamilyChildrenDraft([{ key: 'draft-1', child_name: '', date_of_birth: '', notes: '' }])
    } catch (error) {
      setFamilyFormError(error instanceof Error ? error.message : 'Children could not be submitted right now.')
    }
  }

  const beginRejectedProposalEdit = (proposal: ChildIntakeProposal) => {
    setEditingRejectedProposalId(proposal.id)
    setRejectedProposalName(proposal.child_name)
    setRejectedProposalDob(proposal.date_of_birth || '')
    setRejectedProposalNotes(proposal.notes || '')
    setFamilyFormError(null)
  }

  const handleResubmitRejectedProposal = async () => {
    if (!editingRejectedProposalId) {
      return
    }

    if (!rejectedProposalName.trim()) {
      setFamilyFormError('Child name is required before resubmitting.')
      return
    }

    setFamilyFormError(null)
    try {
      await onResubmitChildIntakeProposal({
        proposalId: editingRejectedProposalId,
        child_name: rejectedProposalName.trim(),
        date_of_birth: rejectedProposalDob || undefined,
        notes: rejectedProposalNotes.trim() || undefined,
      })
      setEditingRejectedProposalId(null)
      setRejectedProposalName('')
      setRejectedProposalDob('')
      setRejectedProposalNotes('')
    } catch (error) {
      setFamilyFormError(error instanceof Error ? error.message : 'Proposal could not be resubmitted right now.')
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
                value={selectedChild?.name || ''}
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
            {isTherapist ? (
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
                  Therapists create child profiles first, then invite parents into the linked child workspace.
                </Text>
              </div>
            ) : (
              <Text className={styles.helperText}>
                Child profiles are created by the therapist. Your linked-child invitations and access updates appear in this workspace after sign-in.
              </Text>
            )}
          </Card>

          <Card className={styles.card}>
            <Text className={styles.cardTitle}>{isTherapist ? 'Linked child access' : 'Linked child access'}</Text>
            {!isTherapist ? (
              <Text className={styles.helperText}>
                Incoming parent invites appear here when a therapist links you to a child profile.
              </Text>
            ) : (
              <Text className={styles.helperText}>
                Family and guardian invites now live in the family intake section below. This legacy child-scoped flow remains only for existing linked-child access.
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
                    <Text className={styles.listMeta}>From {invitation.invited_by_name || 'Therapist'} for {invitation.relationship} access{invitation.workspace_id && userWorkspaces.length > 0 ? ` in ${userWorkspaces.find(w => w.id === invitation.workspace_id)?.name || 'workspace'}` : ''}.</Text>
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

            {isTherapist ? null : (
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
            )}
          </Card>
        </div>

        <div className={styles.sectionGrid}>
          <Card className={styles.card}>
            <Text className={styles.cardTitle}>{isTherapist ? 'Family intake invites' : 'Family intake'}</Text>
            {isTherapist ? (
              <div className={styles.form}>
                <Field label="Invite parent or guardian by email" validationMessage={familyFormError || undefined}>
                  <Input value={familyInviteEmail} onChange={(_, data) => setFamilyInviteEmail(data.value)} />
                </Field>
                <div className={styles.buttonRow}>
                  <Button
                    appearance="primary"
                    onClick={() => void handleCreateFamilyInvite()}
                    disabled={!familyInviteEmail.trim() || familyIntakeActionPendingId === `family-create:${familyInviteEmail.trim().toLowerCase()}`}
                  >
                    {familyIntakeActionPendingId === `family-create:${familyInviteEmail.trim().toLowerCase()}`
                      ? 'Sending family invite...'
                      : 'Send family intake invite'}
                  </Button>
                </div>
                <Text className={styles.helperText}>
                  Use this as the primary new-family flow. The parent or guardian accepts once, submits all children together, and you review each child after submission.
                </Text>
                {familyIntakeError ? <Text className={styles.helperText}>{familyIntakeError}</Text> : null}

                <div className={styles.list}>
                  <div className={styles.statusRow}>
                    <Text className={styles.statusText}>Sent family invites</Text>
                    <Text className={styles.listMeta}>{familyIntakeLoading ? 'Loading...' : `${sentFamilyIntakeInvitations.length}`}</Text>
                  </div>
                  {sentFamilyIntakeInvitations.length === 0 ? (
                    <Text className={styles.emptyState}>No family intake invites sent yet.</Text>
                  ) : (
                    sentFamilyIntakeInvitations.map(invitation => (
                      <div key={invitation.id} className={styles.listItem}>
                        <div className={styles.listHeader}>
                          <Text className={styles.listTitle}>{invitation.workspace_name || 'Workspace invite'}</Text>
                          <Text className={styles.listMeta}>{invitation.status}</Text>
                        </div>
                        <Text className={styles.listMeta}>{invitation.invited_email}</Text>
                        {(() => {
                          const deliveryCopy = getInvitationDeliveryCopy(invitation.email_delivery ?? null)
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
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.list}>
                <div className={styles.statusRow}>
                  <Text className={styles.statusText}>Incoming family invites</Text>
                  <Text className={styles.listMeta}>{familyIntakeLoading ? 'Loading...' : `${pendingIncomingFamilyIntakeInvitations.length}`}</Text>
                </div>
                {pendingIncomingFamilyIntakeInvitations.length === 0 ? (
                  <Text className={styles.emptyState}>No family intake invites are waiting right now.</Text>
                ) : (
                  pendingIncomingFamilyIntakeInvitations.map(invitation => (
                    <div
                      key={invitation.id}
                      ref={element => {
                        familyInvitationRefs.current[invitation.id] = element
                        if (element && typeof element.scrollIntoView === 'function' && highlightedFamilyInvitationId === invitation.id) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                      }}
                      className={mergeClasses(
                        styles.listItem,
                        highlightedFamilyInvitationId === invitation.id && styles.listItemHighlighted,
                      )}
                    >
                      <div className={styles.listHeader}>
                        <Text className={styles.listTitle}>{invitation.workspace_name || 'Therapist workspace'}</Text>
                        <Text className={styles.listMeta}>{invitation.status}</Text>
                      </div>
                      {highlightedFamilyInvitationId === invitation.id ? (
                        <Text className={styles.listMeta}>Linked from your family invitation email.</Text>
                      ) : null}
                      <Text className={styles.listMeta}>From {invitation.invited_by_name || 'Therapist'}.</Text>
                      <div className={styles.buttonRow}>
                        <Button
                          appearance="primary"
                          onClick={() => {
                            void onAcceptFamilyIntakeInvitation(invitation.id).catch(() => undefined)
                          }}
                          disabled={familyIntakeActionPendingId === invitation.id}
                        >
                          Accept
                        </Button>
                        <Button
                          appearance="secondary"
                          onClick={() => {
                            void onDeclineFamilyIntakeInvitation(invitation.id).catch(() => undefined)
                          }}
                          disabled={familyIntakeActionPendingId === invitation.id}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))
                )}

                {acceptedIncomingFamilyIntakeInvitations.length > 0 ? (
                  <>
                    <Field label="Accepted family invite">
                      <Dropdown
                        className={styles.dropdown}
                        selectedOptions={selectedFamilyInvitation ? [selectedFamilyInvitation.id] : []}
                        value={selectedFamilyInvitation?.workspace_name || 'Select accepted invite'}
                        onOptionSelect={(_, data) => {
                          if (data.optionValue) {
                            setSelectedFamilyInvitationId(data.optionValue)
                          }
                        }}
                      >
                        {acceptedIncomingFamilyIntakeInvitations.map(invitation => (
                          <Option key={invitation.id} value={invitation.id} text={invitation.workspace_name || invitation.id}>
                            {invitation.workspace_name || invitation.id}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>
                    <Text className={styles.helperText}>
                      Submit all children once for the selected family invite. Approved children will appear in your child list after therapist review.
                    </Text>
                    {selectedFamilyInvitation?.id === highlightedFamilyInvitationId ? (
                      <Text className={styles.helperText}>Linked from your family invitation email.</Text>
                    ) : null}
                  </>
                ) : null}
                {familyIntakeError ? <Text className={styles.helperText}>{familyIntakeError}</Text> : null}
              </div>
            )}
          </Card>

          <Card className={styles.card}>
            <Text className={styles.cardTitle}>{isTherapist ? 'Child intake review' : 'Child intake submissions'}</Text>
            {isTherapist ? (
              <div className={styles.list}>
                <div className={styles.statusRow}>
                  <Text className={styles.statusText}>Pending review</Text>
                  <Text className={styles.listMeta}>{familyIntakeLoading ? 'Loading...' : `${pendingChildIntakeProposals.length}`}</Text>
                </div>
                {pendingChildIntakeProposals.length === 0 ? (
                  <Text className={styles.emptyState}>No submitted child proposals are waiting for review.</Text>
                ) : (
                  pendingChildIntakeProposals.map(proposal => (
                    <div key={proposal.id} className={styles.listItem}>
                      <div className={styles.listHeader}>
                        <Text className={styles.listTitle}>{proposal.child_name}</Text>
                        <Text className={styles.listMeta}>{proposal.status}</Text>
                      </div>
                      <Text className={styles.listMeta}>Submitted by {proposal.created_by_name || 'Parent or guardian'} in {proposal.workspace_name || 'workspace'}.</Text>
                      {proposal.date_of_birth ? <Text className={styles.listMeta}>DOB {proposal.date_of_birth}</Text> : null}
                      {proposal.notes ? <Text className={styles.listMeta}>{proposal.notes}</Text> : null}
                      <div className={styles.buttonRow}>
                        <Button
                          appearance="primary"
                          onClick={() => {
                            void onApproveChildIntakeProposal(proposal.id).catch(() => undefined)
                          }}
                          disabled={familyIntakeActionPendingId === proposal.id}
                        >
                          Approve
                        </Button>
                        <Button
                          appearance="secondary"
                          onClick={() => {
                            void onRejectChildIntakeProposal(proposal.id).catch(() => undefined)
                          }}
                          disabled={familyIntakeActionPendingId === proposal.id}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : proposalsForSelectedFamilyInvitation.length === 0 ? (
              <div className={styles.form}>
                {familyChildrenDraft.map((draft, index) => (
                  <div key={draft.key} className={styles.listItem}>
                    <Text className={styles.listTitle}>Child {index + 1}</Text>
                    <Field label="Child name">
                      <Input value={draft.child_name} onChange={(_, data) => updateFamilyChildDraft(draft.key, 'child_name', data.value)} />
                    </Field>
                    <Field label="Date of birth">
                      <Input type="date" value={draft.date_of_birth} onChange={(_, data) => updateFamilyChildDraft(draft.key, 'date_of_birth', data.value)} />
                    </Field>
                    <Field label="Notes">
                      <Textarea value={draft.notes} onChange={(_, data) => updateFamilyChildDraft(draft.key, 'notes', data.value)} resize="vertical" />
                    </Field>
                    <div className={styles.buttonRow}>
                      <Button appearance="secondary" onClick={() => removeFamilyChildDraft(draft.key)} disabled={familyChildrenDraft.length === 1}>
                        Remove child
                      </Button>
                    </div>
                  </div>
                ))}
                <div className={styles.buttonRow}>
                  <Button appearance="secondary" onClick={addFamilyChildDraft}>Add another child</Button>
                  <Button
                    appearance="primary"
                    onClick={() => void handleSubmitFamilyChildren()}
                    disabled={!selectedFamilyInvitation || familyIntakeActionPendingId === `family-submit:${selectedFamilyInvitation?.id}`}
                  >
                    {familyIntakeActionPendingId === `family-submit:${selectedFamilyInvitation?.id}` ? 'Submitting children...' : 'Submit children once'}
                  </Button>
                </div>
                {familyFormError ? <Text className={styles.helperText}>{familyFormError}</Text> : null}
              </div>
            ) : (
              <div className={styles.list}>
                <div className={styles.statusRow}>
                  <Text className={styles.statusText}>Submitted children</Text>
                  <Text className={styles.listMeta}>{`${proposalsForSelectedFamilyInvitation.length}`}</Text>
                </div>
                {proposalsForSelectedFamilyInvitation.map(proposal => (
                  <div key={proposal.id} className={styles.listItem}>
                    <div className={styles.listHeader}>
                      <Text className={styles.listTitle}>{proposal.child_name}</Text>
                      <Text className={styles.listMeta}>{proposal.status}</Text>
                    </div>
                    {proposal.notes ? <Text className={styles.listMeta}>{proposal.notes}</Text> : null}
                    {proposal.review_note ? <Text className={styles.listMeta}>Therapist note: {proposal.review_note}</Text> : null}
                    {proposal.status === 'rejected' ? (
                      editingRejectedProposalId === proposal.id ? (
                        <div className={styles.form}>
                          <Field label="Child name">
                            <Input value={rejectedProposalName} onChange={(_, data) => setRejectedProposalName(data.value)} />
                          </Field>
                          <Field label="Date of birth">
                            <Input type="date" value={rejectedProposalDob} onChange={(_, data) => setRejectedProposalDob(data.value)} />
                          </Field>
                          <Field label="Notes">
                            <Textarea value={rejectedProposalNotes} onChange={(_, data) => setRejectedProposalNotes(data.value)} resize="vertical" />
                          </Field>
                          <div className={styles.buttonRow}>
                            <Button
                              appearance="primary"
                              onClick={() => void handleResubmitRejectedProposal()}
                              disabled={familyIntakeActionPendingId === proposal.id}
                            >
                              {familyIntakeActionPendingId === proposal.id ? 'Resubmitting...' : 'Resubmit'}
                            </Button>
                            <Button appearance="secondary" onClick={() => setEditingRejectedProposalId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.buttonRow}>
                          <Button appearance="secondary" onClick={() => beginRejectedProposalEdit(proposal)}>
                            Edit and resubmit
                          </Button>
                        </div>
                      )
                    ) : null}
                  </div>
                ))}
                {familyFormError ? <Text className={styles.helperText}>{familyFormError}</Text> : null}
              </div>
            )}
          </Card>
        </div>

        <div className={styles.sectionGrid}>
          <Card className={styles.card}>
            <Text className={styles.cardTitle}>Data and privacy</Text>
            {selectedChild ? (
              <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <Text className={styles.copy}>
                  Manage data for <strong>{selectedChild.name}</strong>. Export returns a JSON file with all session, assessment, and profile data.
                </Text>
                <div className={styles.buttonRow}>
                  <Button
                    appearance="secondary"
                    disabled={dataExporting}
                    onClick={() => {
                      setDataExporting(true)
                      api.exportChildData(selectedChild.id)
                        .then(data => {
                          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `wulo-data-${selectedChild.name.replace(/\s+/g, '-').toLowerCase()}.json`
                          a.click()
                          URL.revokeObjectURL(url)
                        })
                        .catch(() => setDataDeleteError('Export failed. Please try again.'))
                        .finally(() => setDataExporting(false))
                    }}
                  >
                    {dataExporting ? 'Exporting…' : 'Download data'}
                  </Button>
                  <Button
                    appearance="secondary"
                    disabled={dataDeleting}
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{ color: 'var(--color-error)' }}
                  >
                    Delete all data
                  </Button>
                </div>
                {dataDeleteError ? <Text style={{ color: 'var(--color-error)', fontSize: '0.8125rem' }}>{dataDeleteError}</Text> : null}
              </div>
            ) : (
              <Text className={styles.copy}>Select a child profile to manage their data.</Text>
            )}
          </Card>
        </div>

        <div className={styles.sectionGrid}>
          <Card className={styles.card}>
            <Text className={styles.cardTitle}>Legal</Text>
            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
              <a href="/privacy" style={{ color: 'var(--color-primary)', fontSize: '0.88rem' }}>Privacy Policy</a>
              <a href="/terms" style={{ color: 'var(--color-primary)', fontSize: '0.88rem' }}>Terms of Service</a>
              <a href="/ai-transparency" style={{ color: 'var(--color-primary)', fontSize: '0.88rem' }}>AI Transparency Notice</a>
            </div>
          </Card>
        </div>

        <Dialog open={showDeleteConfirm} onOpenChange={(_, data) => !data.open && setShowDeleteConfirm(false)}>
          <DialogSurface>
            <DialogTitle>Permanently delete all data?</DialogTitle>
            <DialogBody>
              <Text>
                This will permanently delete all session recordings, assessments, memory items, practice plans,
                and profile data for <strong>{selectedChild?.name}</strong>. This action cannot be undone.
              </Text>
            </DialogBody>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                disabled={dataDeleting}
                onClick={() => {
                  if (!selectedChild) return
                  setDataDeleting(true)
                  setDataDeleteError(null)
                  api.deleteChildData(selectedChild.id)
                    .then(() => {
                      setShowDeleteConfirm(false)
                      window.location.reload()
                    })
                    .catch(() => setDataDeleteError('Deletion failed. Please try again.'))
                    .finally(() => setDataDeleting(false))
                }}
                style={{ backgroundColor: 'var(--color-error)' }}
              >
                {dataDeleting ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </DialogActions>
          </DialogSurface>
        </Dialog>
      </div>
    </div>
  )
}