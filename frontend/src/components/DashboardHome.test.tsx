import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardHome } from './DashboardHome'

describe('DashboardHome', () => {
  it('renders compact child-memory signals for the selected child', () => {
    render(
      <DashboardHome
        isTherapistWorkspace
        secondaryActionLabel="Review progress"
        incomingInvitations={[]}
        pendingIncomingFamilyIntakeInvitations={[]}
        invitationActionPendingId={null}
        familyIntakeActionPendingId={null}
        onAcceptInvitation={async () => {}}
        onDeclineInvitation={async () => {}}
        onAcceptFamilyIntakeInvitation={async () => {}}
        onDeclineFamilyIntakeInvitation={async () => {}}
        childProfiles={[{ id: 'child-1', name: 'Amina' }]}
        childrenLoading={false}
        selectedChildId="child-1"
        selectedChild={{ id: 'child-1', name: 'Amina' }}
        selectedAvatar="meg-casual"
        selectedScenario={null}
        childMemorySummary={{
          child_id: 'child-1',
          summary: {
            targets: [{ id: 'memory-1', statement: 'Keep /t/ active.' }],
          },
          summary_text: 'Active targets: Keep /t/ active.',
          source_item_count: 1,
          last_compiled_at: '2026-04-06T12:00:00.000Z',
        }}
        childMemoryProposals={[
          {
            id: 'proposal-1',
            child_id: 'child-1',
            category: 'blockers',
            memory_type: 'inference',
            status: 'pending',
            statement: 'Needs extra support in longer phrases.',
            detail: {},
            confidence: 0.72,
            provenance: {},
            author_type: 'system',
            created_at: '2026-04-06T12:00:00.000Z',
            updated_at: '2026-04-06T12:00:00.000Z',
          },
        ]}
        recommendationHistory={[
          {
            id: 'recommendation-1',
            child_id: 'child-1',
            target_sound: 't',
            therapist_constraints: {},
            ranking_context: {},
            rationale: 'Move into short /t/ phrases while retry energy is high.',
            candidate_count: 3,
            top_recommendation_score: 0.91,
            created_at: '2026-04-06T10:30:00.000Z',
            top_recommendation: {
              rank: 1,
              exercise_id: 'exercise-1',
              exercise_name: 'Short /t/ phrases',
              score: 0.91,
              rationale: 'Move into short /t/ phrases while retry energy is high.',
              supporting_memory_item_ids: ['memory-1'],
              supporting_session_ids: ['session-1'],
            },
          },
        ]}
        launchInFlight={false}
        scenarios={[]}
        customScenarios={[]}
        onSelectChild={() => {}}
        onSelectAvatar={() => {}}
        onSelectScenario={() => {}}
        onStartScenario={() => {}}
        onStartSession={() => {}}
        onSecondaryAction={() => {}}
        onAddCustomScenario={() => {}}
        onUpdateCustomScenario={() => {}}
        onDeleteCustomScenario={() => {}}
      />
    )

    expect(screen.getByText('Active memory')).toBeTruthy()
    expect(screen.getByText('Keep /t/ active.')).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByText('Therapist review is waiting in the progress dashboard.')).toBeTruthy()
    expect(screen.getByText('Top recommendation')).toBeTruthy()
    expect(screen.getByText('Short /t/ phrases')).toBeTruthy()
    expect(screen.getByText('Evidence status')).toBeTruthy()
    expect(screen.getByText('Stale')).toBeTruthy()
  })

  it('does not show the add child action in parent workspace mode', () => {
    render(
      <DashboardHome
        isTherapistWorkspace={false}
        secondaryActionLabel="Open family setup"
        incomingInvitations={[]}
        pendingIncomingFamilyIntakeInvitations={[]}
        invitationActionPendingId={null}
        familyIntakeActionPendingId={null}
        onAcceptInvitation={async () => {}}
        onDeclineInvitation={async () => {}}
        onAcceptFamilyIntakeInvitation={async () => {}}
        onDeclineFamilyIntakeInvitation={async () => {}}
        childProfiles={[]}
        childrenLoading={false}
        selectedChildId={null}
        selectedChild={null}
        selectedAvatar="meg-casual"
        selectedScenario={null}
        childMemorySummary={null}
        childMemoryProposals={[]}
        recommendationHistory={[]}
        launchInFlight={false}
        scenarios={[]}
        customScenarios={[]}
        onSelectChild={() => {}}
        onSelectAvatar={() => {}}
        onSelectScenario={() => {}}
        onStartScenario={() => {}}
        onStartSession={() => {}}
        onSecondaryAction={() => {}}
        onAddCustomScenario={() => {}}
        onUpdateCustomScenario={() => {}}
        onDeleteCustomScenario={() => {}}
      />,
    )

    expect(screen.queryByText('Add child')).toBeNull()
    expect(screen.getByText('Wait for a therapist invitation to link a child profile before you start supervised practice here.')).toBeTruthy()
  })
})