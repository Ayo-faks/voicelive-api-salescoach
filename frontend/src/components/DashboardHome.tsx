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
import { PlusIcon } from '@heroicons/react/24/outline'
import { CustomScenarioEditor } from './CustomScenarioEditor'
import { ScenarioList } from './ScenarioList'
import type {
  ChildProfile,
  CustomScenario,
  CustomScenarioData,
  Scenario,
} from '../types'
import { AVATAR_OPTIONS } from '../types'

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  createAction: {
    minHeight: '36px',
    minWidth: '148px',
    paddingInline: 'var(--space-md)',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.8125rem',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
  },
  tertiaryAction: {
    minHeight: '36px',
    minWidth: '132px',
    paddingInline: 'var(--space-md)',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  hero: {
    display: 'grid',
    gap: 'var(--space-lg)',
    padding: 'clamp(1.35rem, 3vw, 2rem)',
    borderRadius: '0px',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.16), transparent 34%), radial-gradient(circle at bottom left, rgba(13, 138, 132, 0.08), transparent 32%), linear-gradient(135deg, rgba(233, 245, 246, 0.98), rgba(224, 239, 241, 0.98))',
    boxShadow: 'var(--shadow-lg)',
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
    borderRadius: '0px',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at center, rgba(255,255,255,0.96), rgba(232, 245, 242, 0.84))',
    overflow: 'hidden',
  },
  robotPulseRing: {
    position: 'absolute',
    width: '190px',
    height: '190px',
    borderRadius: '50%',
    border: '2px solid rgba(13, 138, 132, 0.14)',
    animationName: {
      '0%': { transform: 'scale(0.92)', opacity: 0.45 },
      '100%': { transform: 'scale(1.28)', opacity: 0 },
    },
    animationDuration: '2.2s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
  },
  robotImage: {
    width: 'min(170px, 78%)',
    height: 'auto',
    zIndex: 1,
    filter: 'none',
    animationName: {
      '0%, 100%': { transform: 'translateY(0) scale(1)' },
      '50%': { transform: 'translateY(-5px) scale(1.03)' },
    },
    animationDuration: '2.8s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  heroControls: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 240px))',
    gap: 'var(--space-md)',
    alignItems: 'end',
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
    fontSize: 'clamp(1.9rem, 4vw, 3rem)',
    fontWeight: '800',
    lineHeight: 0.98,
    letterSpacing: '-0.05em',
    maxWidth: '640px',
  },
  heroHint: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.6,
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
    borderRadius: '0px',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.75rem',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.65,
    fontSize: '0.95rem',
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
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.92rem',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    boxShadow: 'none',
  },
  secondaryAction: {
    minHeight: '46px',
    minWidth: '152px',
    paddingInline: 'var(--space-lg)',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  library: {
    display: 'grid',
  },
})

function formatExerciseType(value?: string) {
  if (!value) return 'Practice exercise'

  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
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
  childProfiles: ChildProfile[]
  childrenLoading: boolean
  selectedChildId: string | null
  selectedChild: ChildProfile | null
  selectedAvatar: string
  selectedScenario: string | null
  launchInFlight: boolean
  scenarios: Scenario[]
  customScenarios: CustomScenario[]
  onSelectChild: (childId: string) => void
  onSelectAvatar: (avatarValue: string) => void
  onSelectScenario: (scenarioId: string) => void
  onStartScenario: (scenarioId: string) => void
  onStartSession: () => void
  onExitToEntry: () => void
  onOpenTherapistReview: () => void
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
  childProfiles,
  childrenLoading,
  selectedChildId,
  selectedChild,
  selectedAvatar,
  selectedScenario,
  launchInFlight,
  scenarios,
  customScenarios,
  onSelectChild,
  onSelectAvatar,
  onSelectScenario,
  onStartScenario,
  onStartSession,
  onExitToEntry,
  onOpenTherapistReview,
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
  const stepNumber = selectedScenarioDetail?.exerciseMetadata?.stepNumber
  const heroHint = selectedScenarioDetail
    ? 'Choose the next exercise, launch a guided session, or review saved progress for this child.'
    : 'Choose a child and exercise to launch a guided session, or open progress review to look back before you start.'
  const heroBody = selectedScenarioDetail?.description || 'Pick an exercise from the library below to prepare the next guided session.'

  return (
    <div className={styles.layout}>
      <div className={styles.topBar}>
        <CustomScenarioEditor
          onSave={onAddCustomScenario}
          trigger={
            <Button
              appearance="primary"
              className={styles.createAction}
              icon={<PlusIcon className="w-5 h-5" />}
            >
              Create Exercise
            </Button>
          }
        />
        <Button
          appearance="subtle"
          className={styles.tertiaryAction}
          onClick={onExitToEntry}
        >
          Switch profile
        </Button>
      </div>

      <Card className={styles.hero}>
        <div className={styles.heroControls}>
          <div>
              <Text className={styles.fieldLabel}>Practising with</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={childrenLoading || childProfiles.length === 0 || launchInFlight}
                placeholder={childrenLoading ? 'Loading child profiles...' : 'Select child'}
                selectedOptions={selectedChildId ? [selectedChildId] : []}
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

        <div className={styles.heroMain}>
          <div className={styles.robotStage} aria-hidden="true">
            <div className={styles.robotPulseRing} />
            <img src="/wulo-robot.webp" alt="" className={styles.robotImage} />
          </div>

          <div className={styles.heroCopy}>
            <Text className={styles.title}>
              {selectedChild ? `Prepare ${selectedChild.name}'s next practice.` : 'Prepare the next practice.'}
            </Text>
            <Text className={styles.heroHint}>{heroHint}</Text>
            <div className={styles.chipRow}>
              <Badge appearance="tint" className={styles.metaBadge}>
                Child: {selectedChild?.name || 'Choose child'}
              </Badge>
              <Badge appearance="tint" className={styles.metaBadge}>
                Buddy: {selectedAvatarOption.label}
              </Badge>
              {selectedScenarioDetail ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Exercise: {selectedScenarioDetail.name}
                </Badge>
              ) : null}
              <Badge appearance="tint" className={styles.metaBadge}>
                {formatExerciseType(selectedScenarioType)}
              </Badge>
              {stepNumber ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Step {stepNumber}
                </Badge>
              ) : null}
              {targetSoundSummary ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Sound: {targetSoundSummary}
                </Badge>
              ) : null}
            </div>
            <Text className={styles.body}>{heroBody}</Text>
            <div className={styles.actionRow}>
              <Button
                appearance="primary"
                className={styles.primaryAction}
                disabled={!canStartSession}
                onClick={onStartSession}
              >
                {launchInFlight ? 'Starting session...' : 'Start session'}
              </Button>
              <Button
                appearance="secondary"
                className={styles.secondaryAction}
                onClick={onOpenTherapistReview}
              >
                Review progress
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <section className={styles.library}>
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
          title="Exercise library"
          helperText="Choose an exercise to launch next."
          showFooter={false}
          showCustomCreateTrigger={false}
        />
      </section>
    </div>
  )
}