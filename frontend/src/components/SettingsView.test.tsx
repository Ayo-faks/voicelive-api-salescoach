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
      />,
    )

    expect(screen.getByText('Linked from your invitation email.')).toBeTruthy()
  })

  it('shows therapist delivery status for sent invites', () => {
    render(
      <SettingsView
        isTherapist
        canManageChildren
        currentMode="workspace"
        authRole="therapist"
        selectedChild={{ id: 'child-1', name: 'Amina' }}
        childProfiles={[{ id: 'child-1', name: 'Amina' }]}
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
      />,
    )

    expect(screen.getByText('Email sent')).toBeTruthy()
    expect(screen.getByText(/acs-message-2/)).toBeTruthy()
  })
})