import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingsView } from './SettingsView'

describe('SettingsView', () => {
  it('highlights the invitation linked from email for parents', () => {
    render(
      <SettingsView
        isTherapist={false}
        canManageChildren
        currentMode="workspace"
        authRole="parent"
        selectedChild={null}
        childProfiles={[]}
        childProfileSaving={false}
        incomingInvitations={[
          {
            id: 'invite-1',
            child_id: 'child-1',
            child_name: 'Amina',
            invited_email: 'parent@example.com',
            relationship: 'parent',
            status: 'pending',
            invited_by_user_id: 'user-1',
            invited_by_name: 'Therapist One',
            created_at: '2026-04-08T10:00:00.000Z',
            updated_at: '2026-04-08T10:00:00.000Z',
            expires_at: '2026-04-15T10:00:00.000Z',
            direction: 'incoming',
          },
        ]}
        sentInvitations={[]}
        highlightedInvitationId="invite-1"
        invitationsLoading={false}
        familyIntakeInvitations={[]}
        incomingFamilyIntakeInvitations={[]}
        pendingIncomingFamilyIntakeInvitations={[]}
        sentFamilyIntakeInvitations={[]}
        childIntakeProposals={[]}
        pendingChildIntakeProposals={[]}
        familyIntakeLoading={false}
        familyIntakeActionPendingId={null}
        activeWorkspaceId={null}
        selectedAvatar="meg-casual"
        onChooseMode={() => {}}
        onSelectChild={() => {}}
        onSelectAvatar={() => {}}
        onCreateChild={async () => ({})}
        onInviteParent={async () => ({})}
        onAcceptInvitation={async () => ({})}
        onDeclineInvitation={async () => ({})}
        onRevokeInvitation={async () => ({})}
        onResendInvitation={async () => ({})}
        onCreateFamilyIntakeInvitation={async () => ({})}
        onAcceptFamilyIntakeInvitation={async () => ({})}
        onDeclineFamilyIntakeInvitation={async () => ({})}
        onSubmitChildIntakeProposals={async () => ({})}
        onApproveChildIntakeProposal={async () => ({})}
        onRejectChildIntakeProposal={async () => ({})}
        onResubmitChildIntakeProposal={async () => ({})}
      />,
    )

    expect(screen.getByText('Linked from your invitation email.')).toBeTruthy()
    expect(screen.getByText('Child profiles are created by the therapist. Your linked-child invitations and access updates appear in this workspace after sign-in.')).toBeTruthy()
    expect(screen.queryByText('Add child profile')).toBeNull()
  })

  it('shows parent sent invites', () => {
    render(
      <SettingsView
        isTherapist={false}
        canManageChildren
        currentMode="workspace"
        authRole="parent"
        selectedChild={null}
        childProfiles={[]}
        childProfileSaving={false}
        incomingInvitations={[]}
        sentInvitations={[
          {
            id: 'invite-2',
            child_id: 'child-1',
            child_name: 'Amina',
            invited_email: 'parent@example.com',
            relationship: 'parent',
            status: 'pending',
            invited_by_user_id: 'user-1',
            invited_by_name: 'Therapist One',
            created_at: '2026-04-08T10:00:00.000Z',
            updated_at: '2026-04-08T10:00:00.000Z',
            expires_at: '2026-04-15T10:00:00.000Z',
            direction: 'sent',
          },
        ]}
        invitationDeliveryById={{
          'invite-2': {
            status: 'sent',
            attempted: true,
            delivered: true,
            provider_message_id: 'acs-message-2',
          },
        }}
        invitationsLoading={false}
        familyIntakeInvitations={[]}
        incomingFamilyIntakeInvitations={[]}
        pendingIncomingFamilyIntakeInvitations={[]}
        sentFamilyIntakeInvitations={[]}
        childIntakeProposals={[]}
        pendingChildIntakeProposals={[]}
        familyIntakeLoading={false}
        familyIntakeActionPendingId={null}
        activeWorkspaceId={null}
        selectedAvatar="meg-casual"
        onChooseMode={() => {}}
        onSelectChild={() => {}}
        onSelectAvatar={() => {}}
        onCreateChild={async () => ({})}
        onInviteParent={async () => ({})}
        onAcceptInvitation={async () => ({})}
        onDeclineInvitation={async () => ({})}
        onRevokeInvitation={async () => ({})}
        onResendInvitation={async () => ({})}
        onCreateFamilyIntakeInvitation={async () => ({})}
        onAcceptFamilyIntakeInvitation={async () => ({})}
        onDeclineFamilyIntakeInvitation={async () => ({})}
        onSubmitChildIntakeProposals={async () => ({})}
        onApproveChildIntakeProposal={async () => ({})}
        onRejectChildIntakeProposal={async () => ({})}
        onResubmitChildIntakeProposal={async () => ({})}
      />,
    )

    expect(screen.getByText('parent@example.com')).toBeTruthy()
    expect(screen.getByText('Resend')).toBeTruthy()
  })

  it('highlights the family invitation linked from email for parents', () => {
    render(
      <SettingsView
        isTherapist={false}
        canManageChildren
        currentMode="workspace"
        authRole="parent"
        selectedChild={null}
        childProfiles={[]}
        childProfileSaving={false}
        incomingInvitations={[]}
        sentInvitations={[]}
        invitationsLoading={false}
        familyIntakeInvitations={[]}
        incomingFamilyIntakeInvitations={[
          {
            id: 'family-invite-1',
            workspace_id: 'workspace-1',
            workspace_name: 'River Clinic',
            invited_email: 'parent@example.com',
            invited_by_user_id: 'user-1',
            invited_by_name: 'Therapist One',
            status: 'pending',
            created_at: '2026-04-08T10:00:00.000Z',
            updated_at: '2026-04-08T10:00:00.000Z',
            expires_at: '2026-04-15T10:00:00.000Z',
            direction: 'incoming',
          },
        ]}
        pendingIncomingFamilyIntakeInvitations={[
          {
            id: 'family-invite-1',
            workspace_id: 'workspace-1',
            workspace_name: 'River Clinic',
            invited_email: 'parent@example.com',
            invited_by_user_id: 'user-1',
            invited_by_name: 'Therapist One',
            status: 'pending',
            created_at: '2026-04-08T10:00:00.000Z',
            updated_at: '2026-04-08T10:00:00.000Z',
            expires_at: '2026-04-15T10:00:00.000Z',
            direction: 'incoming',
          },
        ]}
        highlightedFamilyInvitationId="family-invite-1"
        sentFamilyIntakeInvitations={[]}
        childIntakeProposals={[]}
        pendingChildIntakeProposals={[]}
        familyIntakeLoading={false}
        familyIntakeActionPendingId={null}
        activeWorkspaceId={null}
        selectedAvatar="meg-casual"
        onChooseMode={() => {}}
        onSelectChild={() => {}}
        onSelectAvatar={() => {}}
        onCreateChild={async () => ({})}
        onInviteParent={async () => ({})}
        onAcceptInvitation={async () => ({})}
        onDeclineInvitation={async () => ({})}
        onRevokeInvitation={async () => ({})}
        onResendInvitation={async () => ({})}
        onCreateFamilyIntakeInvitation={async () => ({})}
        onAcceptFamilyIntakeInvitation={async () => ({})}
        onDeclineFamilyIntakeInvitation={async () => ({})}
        onSubmitChildIntakeProposals={async () => ({})}
        onApproveChildIntakeProposal={async () => ({})}
        onRejectChildIntakeProposal={async () => ({})}
        onResubmitChildIntakeProposal={async () => ({})}
      />,
    )

    expect(screen.getByText('Linked from your family invitation email.')).toBeTruthy()
    expect(screen.getByText('Accept')).toBeTruthy()
  })
})