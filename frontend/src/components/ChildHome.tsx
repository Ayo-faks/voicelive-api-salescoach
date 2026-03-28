/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Text, makeStyles } from '@fluentui/react-components'
import type { ChildProfile, Scenario } from '../types'
import { AVATAR_OPTIONS } from '../types'
import { BuddyAvatar } from './BuddyAvatar'
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
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(240px, 0.9fr)',
    gap: 'var(--space-lg)',
    padding: 'var(--space-xl)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.16), transparent 36%), radial-gradient(circle at bottom left, rgba(212, 143, 75, 0.12), transparent 34%), linear-gradient(135deg, rgba(244, 247, 248, 0.94), rgba(240, 245, 247, 0.9))',
    boxShadow: 'var(--shadow-lg)',
    '@media (max-width: 920px)': {
      gridTemplateColumns: '1fr',
      padding: 'var(--space-lg)',
    },
  },
  heroCopy: {
    display: 'grid',
    gap: 'var(--space-sm)',
    alignContent: 'start',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(2rem, 4vw, 3rem)',
    fontWeight: '800',
    lineHeight: 1.02,
    letterSpacing: '-0.05em',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.65,
    fontSize: '0.95rem',
    maxWidth: '620px',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  chip: {
    minHeight: '28px',
    paddingInline: 'var(--space-sm)',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
  },
  action: {
    marginTop: 'var(--space-sm)',
    minHeight: '48px',
    paddingInline: 'var(--space-xl)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    fontSize: '0.95rem',
  },
  avatarStage: {
    display: 'grid',
    placeItems: 'center',
    minHeight: '280px',
    borderRadius: 'calc(var(--radius-lg) + 8px)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background:
      'radial-gradient(circle at center, rgba(255, 255, 255, 0.96), rgba(232, 245, 242, 0.8))',
    textAlign: 'center',
    padding: 'var(--space-lg)',
  },
  buddyAvatarWrap: {
    filter: 'drop-shadow(0 24px 40px rgba(13, 138, 132, 0.24))',
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
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
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
  therapistUnlocked: boolean
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
  therapistUnlocked,
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
  const targetWords = selectedExercise?.exerciseMetadata?.targetWords?.slice(0, 3) || []

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
          {therapistUnlocked ? 'Therapist tools' : 'Therapist access'}
        </Button>
      </div>

      <Card className={styles.hero}>
        <div className={styles.heroCopy}>
          <Text className={styles.title}>
            {selectedChild ? `Hi ${selectedChild.name}, let's practise.` : 'Let\'s practise.'}
          </Text>
          <Text className={styles.body}>
            Pick one activity, tap start, and talk with your practice buddy.
            This screen keeps things short and simple so the child can get into
            the session without therapist dashboard noise.
          </Text>
          <div className={styles.chipRow}>
            <Badge appearance="filled" className={styles.chip}>
              Buddy: {avatarLabel}
            </Badge>
            {selectedExercise ? (
              <Badge appearance="tint" className={styles.chip}>
                Exercise: {selectedExercise.name}
              </Badge>
            ) : null}
            {targetWords.map(word => (
              <Badge key={word} appearance="tint" className={styles.chip}>
                {word}
              </Badge>
            ))}
          </div>
          <Button
            appearance="primary"
            className={styles.action}
            disabled={!selectedScenario}
            onClick={onStartSession}
          >
            Start practice
          </Button>
        </div>

        <div className={styles.avatarStage}>
          <div className={styles.buddyAvatarWrap}>
            <BuddyAvatar avatarValue={selectedAvatar} size={180} />
          </div>
          <Text className={styles.avatarLabel}>{avatarLabel}</Text>
          <Text className={styles.avatarHint}>
            Your practice buddy is ready with short prompts and calm feedback.
          </Text>
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
          helperText="Tap one exercise below. When it feels right, start the session and talk with your buddy."
          showFooter={false}
          showCustomExercises={false}
        />
      </Card>
    </div>
  )
}