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
    gap: 'var(--space-md)',
    alignContent: 'center',
    alignSelf: 'center',
    minHeight: '100%',
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
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  chip: {
    minHeight: '28px',
    paddingInline: 'var(--space-sm)',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  action: {
    minHeight: '46px',
    paddingInline: 'var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.92rem',
    justifySelf: 'center',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    boxShadow: '0 12px 26px rgba(13, 138, 132, 0.2)',
    '@media (max-width: 760px)': {
      width: '100%',
      justifySelf: 'stretch',
    },
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
  ambientOrbWrap: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    minHeight: '182px',
    width: '100%',
  },
  ambientSignal: {
    position: 'absolute',
    borderRadius: '50%',
    border: '1px solid rgba(13, 138, 132, 0.14)',
  },
  ambientSignalOne: {
    width: '184px',
    height: '184px',
  },
  ambientSignalTwo: {
    width: '226px',
    height: '226px',
    border: '1px solid rgba(13, 138, 132, 0.09)',
  },
  ambientOrb: {
    width: '144px',
    height: '144px',
    borderRadius: '50%',
    background:
      'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.26), transparent 32%), linear-gradient(135deg, var(--color-primary), #f0b37a)',
    boxShadow: '0 0 0 20px rgba(13, 138, 132, 0.08), 0 0 58px rgba(13, 138, 132, 0.22)',
    animationName: {
      '0%': { transform: 'scale(1)', opacity: 0.92 },
      '50%': { transform: 'scale(1.06)', opacity: 1 },
      '100%': { transform: 'scale(1)', opacity: 0.92 },
    },
    animationDuration: '1.8s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  ambientCore: {
    position: 'absolute',
    width: '68px',
    height: '68px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.14)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
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
    paddingInline: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  therapistButton: {
    minHeight: '36px',
    paddingInline: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
})

interface Props {
  selectedChild: ChildProfile | null
  selectedAvatar: string
  selectedScenario: string | null
  scenarios: Scenario[]
  isTherapist: boolean
  onExitToEntry: () => void
  onSelectScenario: (scenarioId: string) => void
  onStartSession: () => void
  onOpenTherapistTools: () => void
}

export function ChildHome({
  selectedChild,
  selectedAvatar,
  selectedScenario,
  scenarios,
  isTherapist,
  onExitToEntry,
  onSelectScenario,
  onStartSession,
  onOpenTherapistTools,
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
          Return to start
        </Button>
        <Button
          appearance="subtle"
          className={styles.therapistButton}
          onClick={onOpenTherapistTools}
        >
          {isTherapist ? 'Therapist tools' : 'Therapist access'}
        </Button>
      </div>

      <Card className={styles.hero}>
        <div className={styles.avatarStage}>
          <div className={styles.ambientOrbWrap} aria-hidden="true">
            <div className={`${styles.ambientSignal} ${styles.ambientSignalTwo}`} />
            <div className={`${styles.ambientSignal} ${styles.ambientSignalOne}`} />
            <div className={styles.ambientOrb}>
              <div className={styles.ambientCore} />
            </div>
          </div>
          <Text className={styles.avatarLabel}>{avatarLabel}</Text>
          <Text className={styles.avatarHint}>
            Your practice buddy is ready with short prompts and calm feedback.
          </Text>
        </div>

        <div className={styles.heroCopy}>
          <Text className={styles.title}>
            {selectedChild ? `Hi ${selectedChild.name}, let's practise.` : 'Let\'s practise.'}
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
            disabled={!selectedScenario}
            onClick={onStartSession}
          >
            Start practice
          </Button>
        </div>
      </Card>

      <Card className={styles.exerciseSection}>
        <ScenarioList
          scenarios={scenarios}
          customScenarios={[]}
          selectedScenario={selectedScenario}
          onSelect={onSelectScenario}
          onAddCustomScenario={() => undefined}
          onUpdateCustomScenario={() => undefined}
          onDeleteCustomScenario={() => undefined}
          title="Choose one practice"
          helperText="Use the filters to narrow the list, then tap one card to load it into the start panel."
          showFooter={false}
          showCustomExercises={false}
          compactChildMode
        />
      </Card>
    </div>
  )
}