/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Text, makeStyles } from '@fluentui/react-components'
import type { ChildProfile, Scenario } from '../types'
import { AVATAR_OPTIONS } from '../types'
import { ScenarioList } from './ScenarioList'

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
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 0.82fr) minmax(0, 1.18fr)',
    gridTemplateAreas: '"avatar copy" "action copy"',
    gap: 'var(--space-lg)',
    padding: 'clamp(1.4rem, 3vw, 2.25rem)',
    borderRadius: 'calc(var(--radius-lg) + 6px)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.16), transparent 34%), radial-gradient(circle at bottom left, rgba(13, 138, 132, 0.08), transparent 32%), linear-gradient(135deg, rgba(233, 245, 246, 0.98), rgba(224, 239, 241, 0.98))',
    boxShadow: 'var(--shadow-lg)',
    minHeight: '400px',
    overflow: 'hidden',
    '@media (max-width: 920px)': {
      gridTemplateColumns: '1fr',
      gridTemplateAreas: '"copy" "avatar" "action"',
      padding: 'var(--space-lg)',
      minHeight: 'unset',
    },
  },
  heroCopy: {
    gridArea: 'copy',
    display: 'grid',
    gap: 'var(--space-sm)',
    alignContent: 'center',
    alignSelf: 'center',
    minHeight: '100%',
  },
  eyebrow: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.74rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(2.3rem, 5vw, 4rem)',
    fontWeight: '800',
    lineHeight: 0.96,
    letterSpacing: '-0.05em',
    maxWidth: '520px',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.65,
    fontSize: '0.95rem',
    maxWidth: '560px',
  },
  heroHint: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.84rem',
    lineHeight: 1.55,
    maxWidth: '48ch',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  chip: {
    minHeight: '28px',
    paddingInline: 'var(--space-sm)',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  action: {
    minHeight: '46px',
    minWidth: '152px',
    paddingInline: 'var(--space-lg)',
    borderRadius: '4px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.92rem',
    justifySelf: 'center',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    boxShadow: 'none',
  },
  actionWrap: {
    gridArea: 'action',
    alignSelf: 'end',
    justifySelf: 'start',
    display: 'grid',
    alignItems: 'end',
    justifyItems: 'center',
    width: '100%',
    maxWidth: '340px',
    '@media (max-width: 920px)': {
      justifySelf: 'stretch',
      maxWidth: 'none',
    },
  },
  avatarStage: {
    gridArea: 'avatar',
    display: 'grid',
    placeItems: 'center',
    minHeight: '252px',
    borderRadius: 'calc(var(--radius-lg) + 8px)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at center, rgba(255, 255, 255, 0.96), rgba(232, 245, 242, 0.84))',
    textAlign: 'center',
    padding: '18px',
    alignContent: 'center',
    justifySelf: 'start',
    width: '100%',
    maxWidth: '340px',
    '@media (max-width: 920px)': {
      justifySelf: 'stretch',
      maxWidth: 'none',
    },
  },
  buddyImage: {
    width: 'min(220px, 100%)',
    height: 'auto',
    filter: 'none',
    animationName: {
      '0%, 100%': { transform: 'translateY(0) rotate(0)' },
      '25%': { transform: 'translateY(-6px) rotate(1.25deg)' },
      '75%': { transform: 'translateY(-4px) rotate(-1.25deg)' },
    },
    animationDuration: '3.2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  avatarLabel: {
    marginTop: 'var(--space-md)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1rem',
    fontWeight: '700',
  },
  avatarHint: {
    color: 'var(--color-text-secondary)',
    maxWidth: '220px',
    lineHeight: 1.5,
    fontSize: '0.8125rem',
  },
  exerciseSection: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'linear-gradient(135deg, rgba(233, 245, 246, 0.96), rgba(224, 239, 241, 0.96))',
    boxShadow: 'var(--shadow-md)',
    '@media (max-width: 760px)': {
      padding: 'var(--space-md)',
    },
  },
  exitButton: {
    minHeight: '36px',
    minWidth: '132px',
    paddingInline: 'var(--space-md)',
    borderRadius: '4px',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
})

interface Props {
  selectedChild: ChildProfile | null
  selectedAvatar: string
  selectedScenario: string | null
  launchInFlight: boolean
  scenarios: Scenario[]
  isTherapist: boolean
  onExitToEntry: () => void
  onSelectScenario: (scenarioId: string) => void
  onStartScenario: (scenarioId: string) => void
  onStartSession: () => void
}

export function ChildHome({
  selectedChild,
  selectedAvatar,
  selectedScenario,
  launchInFlight,
  scenarios,
  isTherapist,
  onExitToEntry,
  onSelectScenario,
  onStartScenario,
  onStartSession,
}: Props) {
  const styles = useStyles()
  const avatarLabel =
    AVATAR_OPTIONS.find(option => option.value === selectedAvatar)?.label ||
    'Practice buddy'
  const selectedExercise =
    scenarios.find(scenario => scenario.id === selectedScenario) || null
  const stepNumber = selectedExercise?.exerciseMetadata?.stepNumber
  const targetSound = selectedExercise?.exerciseMetadata?.targetSound

  return (
    <div className={styles.layout}>
      <div className={styles.topBar}>
        <Button
          appearance="subtle"
          className={styles.exitButton}
          onClick={onExitToEntry}
        >
          Switch profile
        </Button>
      </div>

      <Card className={styles.hero}>
        <div className={styles.avatarStage}>
          <img
            src="/wulo-robot.webp"
            alt="Wulo practice buddy"
            className={styles.buddyImage}
          />
          <Text className={styles.avatarLabel}>{avatarLabel}</Text>
          <Text className={styles.avatarHint}>
            Your practice buddy is ready with short prompts and calm feedback.
          </Text>
        </div>

        <div className={styles.heroCopy}>
          <Text className={styles.eyebrow}>Recommended next practice</Text>
          <Text className={styles.title}>
            {selectedChild ? `Hi ${selectedChild.name}, let's practise.` : 'Let\'s practise.'}
          </Text>
          <Text className={styles.heroHint}>
            Start the recommended exercise from here, or browse by step below and tap any card to jump straight in.
          </Text>
          <div className={styles.chipRow}>
            <Badge appearance="tint" className={styles.chip}>
              Buddy: {avatarLabel}
            </Badge>
            {selectedExercise ? (
              <Badge appearance="tint" className={styles.chip}>
                Exercise: {selectedExercise.name}
              </Badge>
            ) : null}
            {stepNumber ? (
              <Badge appearance="tint" className={styles.chip}>
                Step {stepNumber}
              </Badge>
            ) : null}
            {targetSound ? (
              <Badge appearance="tint" className={styles.chip}>
                Sound: {targetSound}
              </Badge>
            ) : null}
          </div>
          {selectedExercise ? (
            <Text className={styles.body}>
              {selectedExercise.description}
            </Text>
          ) : null}
        </div>

        <div className={styles.actionWrap}>
          <Button
            appearance="primary"
            className={styles.action}
            disabled={!selectedScenario || launchInFlight}
            onClick={onStartSession}
          >
            {launchInFlight ? 'Starting...' : 'Start practice'}
          </Button>
        </div>
      </Card>

      <Card className={styles.exerciseSection}>
        <ScenarioList
          scenarios={scenarios}
          customScenarios={[]}
          selectedScenario={selectedScenario}
          onSelect={onSelectScenario}
          onStartScenario={onStartScenario}
          onAddCustomScenario={() => undefined}
          onUpdateCustomScenario={() => undefined}
          onDeleteCustomScenario={() => undefined}
          launchInFlight={launchInFlight}
          title="Choose one practice"
          helperText="Pick a step or sound, then tap any exercise to start right away."
          showFooter={false}
          showCustomExercises={false}
          compactChildMode
        />
      </Card>
    </div>
  )
}