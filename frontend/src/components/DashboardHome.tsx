/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Button,
  Card,
  Dropdown,
  Option,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { ScenarioList } from './ScenarioList'
import type {
  FamilyIntakeInvitation,
  ChildInvitation,
  ChildProfile,
  ChildMemoryProposal,
  ChildMemorySummary,
  CustomScenario,
  CustomScenarioData,
  RecommendationLog,
  Scenario,
} from '../types'
import { AVATAR_OPTIONS } from '../types'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  hero: {
    display: 'grid',
    gap: 'var(--space-lg)',
    padding: 'clamp(1.35rem, 3vw, 2rem)',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
  },
  heroMain: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
    gap: 'var(--space-lg)',
    alignItems: 'center',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  robotStage: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    minHeight: '220px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-elevated)',
    overflow: 'hidden',
  },
  robotPulseRing: {
    position: 'absolute',
    width: '190px',
    height: '190px',
    borderRadius: '50%',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    animationName: {
      '0%': { transform: 'scale(0.94)', opacity: 0.28 },
      '100%': { transform: 'scale(1.2)', opacity: 0 },
    },
    animationDuration: '3.6s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: 0.18,
    },
  },
  robotImage: {
    width: 'min(170px, 78%)',
    height: 'auto',
    zIndex: 1,
    filter: 'none',
    animationName: {
      '0%, 100%': { transform: 'translateY(0) scale(1)' },
      '50%': { transform: 'translateY(-3px) scale(1.015)' },
    },
    animationDuration: '3.4s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
  heroControls: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 240px))',
    gap: 'var(--space-md)',
    alignItems: 'end',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
    '@media (max-width: 760px)': {
      gridTemplateColumns: '1fr',
    },
  },
  fieldLabel: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '600',
    marginBottom: '6px',
  },
  dropdown: {
    minWidth: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  heroCopy: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-display-xl-size)',
    lineHeight: 'var(--font-display-xl-line)',
    fontWeight: 'var(--font-display-xl-weight)' as unknown as number,
    letterSpacing: 'var(--font-display-xl-tracking)',
    maxWidth: '640px',
  },
  heroHint: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-body-15-size)',
    lineHeight: 'var(--font-body-15-line)',
    maxWidth: '58ch',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  metaBadge: {
    minHeight: '28px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.75rem',
    border: '1px solid var(--color-border)',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 'var(--font-body-15-line)',
    fontSize: 'var(--font-body-15-size)',
    maxWidth: '560px',
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
  },
  primaryAction: {
    minHeight: '46px',
    minWidth: '152px',
    paddingInline: 'var(--space-lg)',
    borderRadius: 'var(--radius-card)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.92rem',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    boxShadow: 'none',
  },
  secondaryAction: {
    minHeight: '46px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-card)',
    fontFamily: 'var(--font-display)',
    fontWeight: '500',
    fontSize: '0.92rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-primary)',
    ':hover': {
      backgroundColor: 'rgba(13, 138, 132, 0.06)',
      color: 'var(--color-primary-dark)',
    },
  },
  exerciseSection: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    '@media (max-width: 760px)': {
      padding: 'var(--space-md)',
    },
  },
  library: {
    display: 'grid',
  },
  memorySignalStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  },
  memorySignalCard: {
    display: 'grid',
    gap: '6px',
    padding: '12px 14px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  memorySignalLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontWeight: '700',
  },
  memorySignalValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1rem',
    fontWeight: '600',
    lineHeight: 1.2,
  },
  memorySignalCopy: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.45,
  },
  suggestedNextRow: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  suggestedNextLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontWeight: '700',
  },
  suggestedNextValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.95rem',
    fontWeight: '600',
  },
  suggestedNextReason: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.85rem',
    flex: '1 1 auto',
  },
  suggestedNextLink: {
    paddingInline: '4px',
    minHeight: 'auto',
    color: 'var(--color-primary)',
    fontWeight: '500',
  },
})

function formatExerciseType(value?: string) {
  if (!value) return 'Practice exercise'

  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatSignalTimestamp(value?: string | null) {
  if (!value) return 'Not run yet'

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isCustomScenario(
  scenario: Scenario | CustomScenario | null | undefined
): scenario is CustomScenario {
  return Boolean(scenario && 'scenarioData' in scenario)
}

function getTargetSoundSummary(selectedScenario: Scenario | CustomScenario | null) {
  if (selectedScenario && 'scenarioData' in selectedScenario) {
    return selectedScenario.scenarioData.targetSound || 'Custom focus'
  }

  return selectedScenario?.exerciseMetadata?.targetSound || null
}

interface DashboardHomeProps {
  isTherapistWorkspace: boolean
  secondaryActionLabel: string
  secondaryActionDisabled?: boolean
  incomingInvitations: ChildInvitation[]
  pendingIncomingFamilyIntakeInvitations: FamilyIntakeInvitation[]
  invitationActionPendingId: string | null
  familyIntakeActionPendingId: string | null
  onAcceptInvitation: (invitationId: string) => Promise<unknown>
  onDeclineInvitation: (invitationId: string) => Promise<unknown>
  onAcceptFamilyIntakeInvitation: (invitationId: string) => Promise<unknown>
  onDeclineFamilyIntakeInvitation: (invitationId: string) => Promise<unknown>
  childProfiles: ChildProfile[]
  childrenLoading: boolean
  selectedChildId: string | null
  selectedChild: ChildProfile | null
  selectedAvatar: string
  selectedScenario: string | null
  childMemorySummary: ChildMemorySummary | null
  childMemoryProposals: ChildMemoryProposal[]
  recommendationHistory: RecommendationLog[]
  launchInFlight: boolean
  scenarios: Scenario[]
  customScenarios: CustomScenario[]
  onSelectChild: (childId: string) => void
  onSelectAvatar: (avatarValue: string) => void
  onSelectScenario: (scenarioId: string) => void
  onStartScenario: (scenarioId: string) => void
  onStartSession: () => void
  onSecondaryAction: () => void
  onOpenRecommendations?: () => void
  onAddCustomScenario: (
    name: string,
    description: string,
    data: CustomScenarioData
  ) => void
  onUpdateCustomScenario: (
    id: string,
    updates: Partial<
      Pick<CustomScenario, 'name' | 'description' | 'scenarioData'>
    >
  ) => void
  onDeleteCustomScenario: (id: string) => void
}

export function DashboardHome({
  isTherapistWorkspace,
  secondaryActionLabel,
  secondaryActionDisabled = false,
  incomingInvitations,
  pendingIncomingFamilyIntakeInvitations,
  invitationActionPendingId,
  familyIntakeActionPendingId,
  onAcceptInvitation,
  onDeclineInvitation,
  onAcceptFamilyIntakeInvitation,
  onDeclineFamilyIntakeInvitation,
  childProfiles,
  childrenLoading,
  selectedChildId,
  selectedChild,
  selectedAvatar,
  selectedScenario,
  childMemorySummary,
  childMemoryProposals,
  recommendationHistory,
  launchInFlight,
  scenarios,
  customScenarios,
  onSelectChild,
  onSelectAvatar,
  onSelectScenario,
  onStartScenario,
  onStartSession,
  onSecondaryAction,
  onOpenRecommendations,
  onAddCustomScenario,
  onUpdateCustomScenario,
  onDeleteCustomScenario,
}: DashboardHomeProps) {
  const styles = useStyles()

  const selectedAvatarOption =
    AVATAR_OPTIONS.find(option => option.value === selectedAvatar) ||
    AVATAR_OPTIONS[0]

  const selectedScenarioDetail =
    scenarios.find(scenario => scenario.id === selectedScenario) ||
    customScenarios.find(scenario => scenario.id === selectedScenario) ||
    null

  const canStartSession = Boolean(selectedChildId && selectedScenario && !launchInFlight)
  const targetSoundSummary = getTargetSoundSummary(selectedScenarioDetail)
  const selectedScenarioType = isCustomScenario(selectedScenarioDetail)
    ? selectedScenarioDetail.scenarioData.exerciseType
    : selectedScenarioDetail?.exerciseMetadata?.type
  const activeTarget = childMemorySummary?.summary.targets?.[0]?.statement ?? null
  const lastMemoryRefresh = childMemorySummary?.last_compiled_at ?? null
  const pendingProposalCount = childMemoryProposals.length
  const latestRecommendation = recommendationHistory[0] ?? null
  const topRecommendation = latestRecommendation?.top_recommendation ?? null
  const incomingInvitationCount = incomingInvitations.length
  const pendingFamilyIntakeInvitationCount = pendingIncomingFamilyIntakeInvitations.length
  const hasLinkedChildren = childProfiles.length > 0
  const showParentPendingFamilyIntakeInvitations = !isTherapistWorkspace && !hasLinkedChildren && pendingFamilyIntakeInvitationCount > 0
  const showParentPendingInvitations = !isTherapistWorkspace && !hasLinkedChildren && incomingInvitationCount > 0
  const showParentNoLinkedChildren = !isTherapistWorkspace && !hasLinkedChildren && incomingInvitationCount === 0
  const showParentNeedsChildSelection = !isTherapistWorkspace && hasLinkedChildren && !selectedChild
  const heroHint = isTherapistWorkspace
    ? selectedScenarioDetail
      ? 'Choose the next exercise, launch a guided session, or review saved progress for this child.'
      : 'Choose a child and exercise to launch a guided session, or open progress review to look back before you start.'
    : hasLinkedChildren
      ? 'Choose a linked child and exercise, then hand over the device when you are ready to start practice.'
      : pendingFamilyIntakeInvitationCount > 0
        ? 'Accept the family intake invite, then open family setup once to submit every child together.'
      : incomingInvitationCount > 0
        ? 'Open the workspace to accept the linked-child invitation before you start practice here.'
        : 'Wait for a therapist invitation to link a child profile before you start supervised practice here.'
  const heroBody = selectedScenarioDetail?.description || (isTherapistWorkspace
    ? 'Pick an exercise from the library below to prepare the next guided session.'
    : hasLinkedChildren
      ? 'Use this space to launch a short supervised practice for the active child.'
      : pendingFamilyIntakeInvitationCount > 0
        ? 'A therapist has invited your family. Accept the invite here, then open family setup to submit all children in one step.'
      : incomingInvitationCount > 0
        ? 'Your linked child invitation is waiting in the workspace area.'
        : 'No child is linked yet, so practice cannot start until a child profile is available.')
  const startButtonLabel = isTherapistWorkspace ? 'Start session' : 'Start practice'

  return (
    <div className={styles.layout}>
      <Card className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.robotStage} aria-hidden="true">
            <div className={styles.robotPulseRing} />
            <img src="/wulo-robot.webp" alt="" className={styles.robotImage} />
          </div>

          <div className={styles.heroCopy}>
            <Text className={styles.title}>
              {selectedChild
                ? isTherapistWorkspace
                  ? `Prepare ${selectedChild.name}'s next practice.`
                  : `Start ${selectedChild.name}'s supervised practice.`
                : isTherapistWorkspace
                  ? 'Prepare the next practice.'
                  : 'Start supervised practice.'}
            </Text>
            <Text className={styles.heroHint}>{heroHint}</Text>
            <Text className={styles.body}>{heroBody}</Text>
            <div className={styles.actionRow}>
              <Button
                appearance="primary"
                className={styles.primaryAction}
                disabled={!canStartSession}
                onClick={onStartSession}
              >
                {launchInFlight ? `${startButtonLabel}...` : startButtonLabel}
              </Button>
              <Button
                appearance="transparent"
                className={styles.secondaryAction}
                disabled={secondaryActionDisabled}
                onClick={onSecondaryAction}
              >
                {secondaryActionLabel}
              </Button>
            </div>
            <div className={styles.chipRow}>
              <Badge appearance="tint" className={styles.metaBadge}>
                Buddy: {selectedAvatarOption.label}
              </Badge>
              {selectedScenarioDetail ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Exercise: {selectedScenarioDetail.name}
                </Badge>
              ) : (
                <Badge appearance="tint" className={styles.metaBadge}>
                  {formatExerciseType(selectedScenarioType)}
                </Badge>
              )}
              {targetSoundSummary ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Sound: {targetSoundSummary}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.heroControls}>
          <div>
              <Text className={styles.fieldLabel}>Practising with</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={childrenLoading || childProfiles.length === 0 || launchInFlight}
                placeholder={childrenLoading ? 'Loading child profiles...' : 'Select child'}
                selectedOptions={selectedChildId ? [selectedChildId] : []}
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
          </div>

          <div>
              <Text className={styles.fieldLabel}>Avatar</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={launchInFlight}
                selectedOptions={[selectedAvatar]}
                value={selectedAvatarOption.label}
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
          </div>
        </div>

        {selectedChild ? (
          <>
            <div className={styles.memorySignalStrip}>
              <div className={styles.memorySignalCard}>
                <Text className={styles.memorySignalLabel}>Active memory</Text>
                <Text className={styles.memorySignalValue}>
                  {childMemorySummary?.source_item_count ?? 0}
                </Text>
                <Text className={styles.memorySignalCopy}>
                  {activeTarget || 'No approved memory has been compiled for this child yet.'}
                </Text>
              </div>

              <div className={styles.memorySignalCard}>
                <Text className={styles.memorySignalLabel}>Needs review</Text>
                <Text className={styles.memorySignalValue}>{pendingProposalCount}</Text>
                <Text className={styles.memorySignalCopy}>
                  {pendingProposalCount
                    ? isTherapistWorkspace
                      ? 'Therapist review is waiting in the progress dashboard.'
                      : 'Open the workspace to review the latest linked-child updates.'
                    : 'No pending memory proposals are waiting right now.'}
                </Text>
              </div>

              <div className={styles.memorySignalCard}>
                <Text className={styles.memorySignalLabel}>Last memory refresh</Text>
                <Text className={styles.memorySignalValue}>
                  {lastMemoryRefresh ? 'Current' : 'Not started'}
                </Text>
                <Text className={styles.memorySignalCopy}>
                  {lastMemoryRefresh
                    ? `Compiled ${formatSignalTimestamp(lastMemoryRefresh)}.`
                    : 'Approved memory will appear here after the first review cycle.'}
                </Text>
              </div>
            </div>

            {onOpenRecommendations ? (
              <div className={styles.suggestedNextRow}>
                <Text className={styles.suggestedNextLabel}>Suggested next</Text>
                <Text className={styles.suggestedNextValue}>
                  {topRecommendation?.exercise_name || 'No saved run'}
                </Text>
                <Text className={styles.suggestedNextReason}>
                  {topRecommendation?.rationale
                    || (latestRecommendation
                      ? 'Open progress to review the latest saved recommendation run.'
                      : 'Generate recommendations in progress to surface the next suggested exercise.')}
                </Text>
                <Button
                  appearance="transparent"
                  className={styles.suggestedNextLink}
                  onClick={onOpenRecommendations}
                >
                  {latestRecommendation ? 'Open recommendations →' : 'Generate in progress →'}
                </Button>
              </div>
            ) : null}
          </>
        ) : showParentPendingFamilyIntakeInvitations || showParentPendingInvitations || showParentNoLinkedChildren || showParentNeedsChildSelection ? (
          <div className={styles.memorySignalStrip}>
            {showParentPendingFamilyIntakeInvitations ? (
              pendingIncomingFamilyIntakeInvitations.map(invitation => (
                <div key={invitation.id} className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>Family invite from {invitation.invited_by_name || 'Therapist'}</Text>
                  <Text className={styles.memorySignalValue}>{invitation.workspace_name || 'Family intake'}</Text>
                  <Text className={styles.memorySignalCopy}>
                    Accept once, then open family setup to submit all children together.
                  </Text>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <Button
                      appearance="primary"
                      size="small"
                      disabled={familyIntakeActionPendingId === invitation.id}
                      onClick={() => { void onAcceptFamilyIntakeInvitation(invitation.id).catch(() => undefined) }}
                    >
                      Accept
                    </Button>
                    <Button
                      appearance="secondary"
                      size="small"
                      disabled={familyIntakeActionPendingId === invitation.id}
                      onClick={() => { void onDeclineFamilyIntakeInvitation(invitation.id).catch(() => undefined) }}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))
            ) : null}

            {showParentPendingInvitations ? (
              incomingInvitations.map(invitation => (
                <div key={invitation.id} className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>Invitation from {invitation.invited_by_name || 'Therapist'}</Text>
                  <Text className={styles.memorySignalValue}>{invitation.child_name}</Text>
                  <Text className={styles.memorySignalCopy}>
                    Accept to link this child and start supervised practice.
                  </Text>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <Button
                      appearance="primary"
                      size="small"
                      disabled={invitationActionPendingId === invitation.id}
                      onClick={() => { void onAcceptInvitation(invitation.id).catch(() => undefined) }}
                    >
                      Accept
                    </Button>
                    <Button
                      appearance="secondary"
                      size="small"
                      disabled={invitationActionPendingId === invitation.id}
                      onClick={() => { void onDeclineInvitation(invitation.id).catch(() => undefined) }}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))
            ) : null}

            {showParentNoLinkedChildren ? (
              <>
                <div className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>No linked child yet</Text>
                  <Text className={styles.memorySignalValue}>Action needed</Text>
                  <Text className={styles.memorySignalCopy}>
                    Add a child profile here or wait for a therapist invitation to unlock supervised practice.
                  </Text>
                </div>

                <div className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>Next step</Text>
                  <Text className={styles.memorySignalValue}>Open family setup</Text>
                  <Text className={styles.memorySignalCopy}>
                    Family setup is where you manage linked children, invitations, and practice access.
                  </Text>
                </div>
              </>
            ) : null}

            {showParentNeedsChildSelection ? (
              <>
                <div className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>Child selection</Text>
                  <Text className={styles.memorySignalValue}>Choose one child</Text>
                  <Text className={styles.memorySignalCopy}>
                    Pick the child you are practising with to load the right exercises and memory context.
                  </Text>
                </div>

                <div className={styles.memorySignalCard}>
                  <Text className={styles.memorySignalLabel}>Workspace</Text>
                  <Text className={styles.memorySignalValue}>Family overview</Text>
                  <Text className={styles.memorySignalCopy}>
                    Open the workspace to review linked children, invitations, and the current practice setup.
                  </Text>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className={styles.exerciseSection}>
        <ScenarioList
          scenarios={scenarios}
          customScenarios={customScenarios}
          selectedScenario={selectedScenario}
          onSelect={onSelectScenario}
          onStartScenario={onStartScenario}
          onAddCustomScenario={onAddCustomScenario}
          onUpdateCustomScenario={onUpdateCustomScenario}
          onDeleteCustomScenario={onDeleteCustomScenario}
          launchInFlight={launchInFlight}
          title={isTherapistWorkspace ? 'Exercise library' : 'Practice library'}
          showFooter={false}
          showCustomCreateTrigger={false}
          compactChildMode
        />
      </Card>
    </div>
  )
}