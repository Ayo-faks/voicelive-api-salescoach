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
  Spinner,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import {
  ClipboardTaskRegular,
  PersonHeartRegular,
  PersonVoiceRegular,
  TargetRegular,
} from '@fluentui/react-icons'
import { ScenarioList } from './ScenarioList'
import type {
  ChildProfile,
  CustomScenario,
  CustomScenarioData,
  Scenario,
  SessionSummary,
} from '../types'
import { AVATAR_OPTIONS } from '../types'

const useStyles = makeStyles({
  topBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    marginBottom: 'var(--space-md)',
  },
  shell: {
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: 'var(--space-xl)',
    alignItems: 'start',
    '@media (max-width: 1080px)': {
      gridTemplateColumns: '1fr',
      gap: 'var(--space-lg)',
    },
  },
  sidebar: {
    display: 'grid',
    gap: 'var(--space-md)',
    '@media (min-width: 1081px)': {
      position: 'sticky',
      top: 'var(--space-xl)',
    },
  },
  panel: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-lg)',
    display: 'grid',
    gap: 'var(--space-md)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  panelCompact: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  helperText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    lineHeight: 1.55,
  },
  actionHint: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.76rem',
    lineHeight: 1.5,
  },
  fieldGroup: {
    display: 'grid',
    gap: '6px',
  },
  fieldLabel: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '600',
  },
  dropdown: {
    minWidth: '100%',
  },
  primaryAction: {
    minHeight: '48px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
    color: 'var(--color-text-inverse)',
    border: 'none',
    boxShadow: '0 16px 30px rgba(13, 138, 132, 0.18)',
  },
  secondaryAction: {
    minHeight: '40px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    border: '1px solid var(--color-border)',
  },
  tertiaryAction: {
    minHeight: '36px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  selectedExercise: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-primary-softer)',
    border: '1px solid rgba(13, 138, 132, 0.14)',
    display: 'grid',
    gap: '6px',
  },
  selectedExerciseTitle: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
    fontSize: '0.875rem',
  },
  selectedExerciseText: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.5,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  metaBadge: {
    minHeight: '24px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.75rem',
  },
  insightRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-sm)',
  },
  insightTile: {
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: '1px solid var(--color-border)',
    display: 'grid',
    gap: '2px',
  },
  insightLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  insightValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.1rem',
    fontWeight: '700',
  },
  main: {
    display: 'grid',
    gap: 'var(--space-xl)',
  },
  hero: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-xl)',
    border: '1px solid var(--color-border)',
    background:
      'radial-gradient(circle at top right, rgba(13, 138, 132, 0.16), transparent 30%), radial-gradient(circle at bottom left, rgba(212, 143, 75, 0.12), transparent 34%), linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(240, 245, 247, 0.92))',
    boxShadow: 'var(--shadow-lg)',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(280px, 0.9fr)',
    gap: 'var(--space-lg)',
    alignItems: 'stretch',
    '@media (max-width: 980px)': {
      gridTemplateColumns: '1fr',
    },
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  heroCopy: {
    display: 'grid',
    gap: 'var(--space-md)',
    alignContent: 'start',
  },
  heroTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: 'clamp(1.9rem, 3.8vw, 2.8rem)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
    lineHeight: 1.05,
  },
  heroText: {
    color: 'var(--color-text-secondary)',
    maxWidth: '560px',
    lineHeight: 1.65,
    fontSize: '0.95rem',
  },
  heroHighlights: {
    display: 'grid',
    gap: 'var(--space-sm)',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  highlightCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255, 255, 255, 0.74)',
    border: '1px solid rgba(17, 36, 58, 0.08)',
    display: 'grid',
    gap: '4px',
  },
  highlightLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.74rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  highlightValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.35rem',
    fontWeight: '700',
  },
  highlightHint: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
  },
  avatarStage: {
    minHeight: '340px',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-lg)',
    background:
      'linear-gradient(180deg, rgba(13, 138, 132, 0.12), rgba(255, 255, 255, 0.94)), radial-gradient(circle at center, rgba(212, 143, 75, 0.18), transparent 52%)',
    border: '1px solid rgba(13, 138, 132, 0.14)',
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'space-between',
    textAlign: 'center',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
    '@media (max-width: 720px)': {
      minHeight: '280px',
    },
  },
  avatarBubble: {
    width: '140px',
    height: '140px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))',
    color: 'var(--color-text-inverse)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 24px 50px rgba(13, 138, 132, 0.24)',
  },
  avatarMeta: {
    display: 'grid',
    gap: '6px',
  },
  avatarName: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.4rem',
    fontWeight: '700',
    letterSpacing: '-0.03em',
  },
  avatarHint: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.85rem',
    lineHeight: 1.5,
    maxWidth: '280px',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 'var(--space-md)',
    '@media (max-width: 1100px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  metricCard: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  metricHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  metricIcon: {
    width: '34px',
    height: '34px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricTitle: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8rem',
    fontWeight: '600',
  },
  metricValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: '1.8rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  metricCaption: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.5,
  },
  lowerGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(280px, 0.9fr)',
    gap: 'var(--space-md)',
    '@media (max-width: 980px)': {
      gridTemplateColumns: '1fr',
    },
  },
  listCard: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gap: 'var(--space-md)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  sessionList: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  sessionItem: {
    display: 'grid',
    gap: '6px',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-bg-muted)',
    border: '1px solid rgba(17, 36, 58, 0.08)',
  },
  sessionMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  sessionTitle: {
    color: 'var(--color-text-primary)',
    fontWeight: '700',
    fontSize: '0.85rem',
  },
  sessionCaption: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.45,
  },
  emptyState: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--color-border-strong)',
    backgroundColor: 'var(--color-bg-muted)',
    textAlign: 'center',
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
  },
  exercisePanel: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-xl)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-lg)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
    },
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

function formatDateLabel(value?: string | null) {
  if (!value) return 'Not yet started'

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatShortDate(value?: string | null) {
  if (!value) return 'No date'

  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value)}%`
}

function getRecentSessions(sessionSummaries: SessionSummary[]) {
  return [...sessionSummaries]
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    )
    .slice(0, 4)
}

function getAverageScore(sessionSummaries: SessionSummary[]) {
  const scores = sessionSummaries
    .map(session => session.overall_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length === 0) return null

  return scores.reduce((total, score) => total + score, 0) / scores.length
}

function getTrendLabel(sessionSummaries: SessionSummary[]) {
  const scores = [...sessionSummaries]
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    )
    .map(session => session.overall_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length < 2) return 'Build a baseline with a few sessions'

  const midpoint = Math.max(1, Math.floor(scores.length / 2))
  const earlyScores = scores.slice(0, midpoint)
  const recentScores = scores.slice(midpoint)
  const earlyAverage = earlyScores.reduce((total, score) => total + score, 0) / earlyScores.length
  const recentAverage = recentScores.reduce((total, score) => total + score, 0) / recentScores.length
  const delta = Math.round(recentAverage - earlyAverage)

  if (delta >= 6) return `Recent sessions are trending up by ${delta} points`
  if (delta <= -6) return `Recent sessions dipped by ${Math.abs(delta)} points`
  return 'Recent sessions are staying steady'
}

function getTargetSoundSummary(sessionSummaries: SessionSummary[], selectedScenario: Scenario | CustomScenario | null) {
  const sounds = sessionSummaries
    .map(session => session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound)
    .filter((sound): sound is string => Boolean(sound))

  if (sounds.length > 0) {
    return Array.from(new Set(sounds)).slice(0, 3).join(', ')
  }

  if (selectedScenario && 'scenarioData' in selectedScenario) {
    return selectedScenario.scenarioData.targetSound || 'Set in custom exercise'
  }

  return selectedScenario?.exerciseMetadata?.targetSound || 'Choose an exercise to focus the session'
}

interface DashboardHomeProps {
  childProfiles: ChildProfile[]
  childrenLoading: boolean
  selectedChildId: string | null
  selectedChild: ChildProfile | null
  selectedAvatar: string
  selectedScenario: string | null
  scenarios: Scenario[]
  customScenarios: CustomScenario[]
  sessionSummaries: SessionSummary[]
  loadingSessions: boolean
  therapistUnlocked: boolean
  onSelectChild: (childId: string) => void
  onSelectAvatar: (avatarValue: string) => void
  onSelectScenario: (scenarioId: string) => void
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
  scenarios,
  customScenarios,
  sessionSummaries,
  loadingSessions,
  therapistUnlocked,
  onSelectChild,
  onSelectAvatar,
  onSelectScenario,
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

  const recentSessions = getRecentSessions(sessionSummaries)
  const averageScore = getAverageScore(sessionSummaries)
  const sessionCount = selectedChild?.session_count ?? sessionSummaries.length
  const canStartSession = Boolean(selectedChildId && selectedScenario)
  const selectedScenarioType = isCustomScenario(selectedScenarioDetail)
    ? selectedScenarioDetail.scenarioData.exerciseType
    : selectedScenarioDetail?.exerciseMetadata?.type
  const targetSoundSummary = getTargetSoundSummary(
    sessionSummaries,
    selectedScenarioDetail
  )
  const recentExerciseSummary = recentSessions[0]?.exercise.name || 'Choose an exercise to begin'

  return (
    <div>
      <div className={styles.topBar}>
        <Button
          appearance="subtle"
          className={styles.tertiaryAction}
          onClick={onExitToEntry}
        >
          Return to start
        </Button>
      </div>

      <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Card className={styles.panel}>
          <div>
            <Text className={styles.sectionTitle}>Prepare the child session</Text>
          </div>

          <div className={styles.fieldGroup}>
            <Text className={styles.fieldLabel}>Practising with</Text>
            <Dropdown
              className={styles.dropdown}
              disabled={childrenLoading || childProfiles.length === 0}
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

          <div className={styles.fieldGroup}>
            <Text className={styles.fieldLabel}>Avatar</Text>
            <Dropdown
              className={styles.dropdown}
              selectedOptions={[selectedAvatar]}
              value={selectedAvatarOption?.label}
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

          <div className={styles.selectedExercise}>
            <Text className={styles.fieldLabel}>Selected exercise</Text>
            <Text className={styles.selectedExerciseTitle}>
              {selectedScenarioDetail?.name || 'Choose an exercise below'}
            </Text>
            <Text className={styles.selectedExerciseText}>
              {selectedScenarioDetail?.description ||
                'Recommended exercises and therapist-authored activities appear below.'}
            </Text>
            <div className={styles.badgeRow}>
              <Badge appearance="filled" className={styles.metaBadge}>
                {formatExerciseType(selectedScenarioType)}
              </Badge>
              {targetSoundSummary ? (
                <Badge appearance="tint" className={styles.metaBadge}>
                  Sound: {targetSoundSummary}
                </Badge>
              ) : null}
            </div>
          </div>

          <Button
            appearance="primary"
            className={styles.primaryAction}
            disabled={!canStartSession}
            onClick={onStartSession}
          >
            Start child session
          </Button>

          {!canStartSession ? (
            <Text className={styles.actionHint}>
              {!selectedChildId
                ? 'Choose a child profile to unlock the session start button.'
                : 'Choose an exercise to unlock the session start button.'}
            </Text>
          ) : null}

          {therapistUnlocked ? (
            <Button
              appearance="secondary"
              className={styles.secondaryAction}
              onClick={onOpenTherapistReview}
            >
              Open therapist review
            </Button>
          ) : null}
        </Card>

        <Card className={styles.panelCompact}>
          <div className={styles.insightRow}>
            <div className={styles.insightTile}>
              <Text className={styles.insightLabel}>Sessions</Text>
              <Text className={styles.insightValue}>{sessionCount}</Text>
            </div>
            <div className={styles.insightTile}>
              <Text className={styles.insightLabel}>Last practice</Text>
              <Text className={styles.insightValue}>
                {selectedChild?.last_session_at
                  ? formatShortDate(selectedChild.last_session_at)
                  : 'New'}
              </Text>
            </div>
          </div>
          <Text className={styles.helperText}>
            {selectedChild
              ? `${selectedChild.name} is ready for a calm, guided voice practice session.`
              : 'Choose a child profile to tailor the next practice session.'}
          </Text>
        </Card>
      </aside>

      <div className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div>
              <Text className={styles.heroTitle}>
                {selectedChild
                  ? `Ready for ${selectedChild.name}'s next practice?`
                  : 'Set up the next Wulo practice session.'}
              </Text>
            </div>

            <div className={styles.heroHighlights}>
              <div className={styles.highlightCard}>
                <Text className={styles.highlightLabel}>Average score</Text>
                <Text className={styles.highlightValue}>{formatScore(averageScore)}</Text>
                <Text className={styles.highlightHint}>
                  {sessionSummaries.length > 0
                    ? 'Based on the recent saved sessions for this child.'
                    : 'Scores will appear after the first analysed session.'}
                </Text>
              </div>
              <div className={styles.highlightCard}>
                <Text className={styles.highlightLabel}>Last session</Text>
                <Text className={styles.highlightValue}>
                  {formatShortDate(selectedChild?.last_session_at)}
                </Text>
                <Text className={styles.highlightHint}>
                  {recentExerciseSummary}
                </Text>
              </div>
              <div className={styles.highlightCard}>
                <Text className={styles.highlightLabel}>Trend</Text>
                <Text className={styles.highlightValue}>
                  {sessionSummaries.length > 1 ? 'Steady view' : 'Starting out'}
                </Text>
                <Text className={styles.highlightHint}>{getTrendLabel(sessionSummaries)}</Text>
              </div>
            </div>
          </div>

          <div className={styles.avatarStage}>
            <Badge appearance="filled" className={styles.metaBadge}>
              {selectedAvatarOption.label}
            </Badge>
            <div className={styles.avatarBubble}>
              <PersonVoiceRegular fontSize={58} />
            </div>
            <div className={styles.avatarMeta}>
              <Text className={styles.avatarName}>
                {selectedAvatarOption.label.split(' (')[0]}
              </Text>
              <Text className={styles.avatarHint}>
                The selected coach is ready to lead {selectedChild?.name || 'the child'} through {selectedScenarioDetail?.name || 'the next exercise'} with a calm, guided prompt.
              </Text>
            </div>
          </div>
        </section>

        <section className={styles.metricsGrid}>
          <Card className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricIcon}>
                <ClipboardTaskRegular />
              </span>
              <Text className={styles.metricTitle}>Session count</Text>
            </div>
            <Text className={styles.metricValue}>{sessionCount}</Text>
            <Text className={styles.metricCaption}>
              Saved practice sessions for {selectedChild?.name || 'the selected child'}.
            </Text>
          </Card>

          <Card className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricIcon}>
                <TargetRegular />
              </span>
              <Text className={styles.metricTitle}>Target sounds</Text>
            </div>
            <Text className={styles.metricValue}>{targetSoundSummary}</Text>
            <Text className={styles.metricCaption}>
              Sounds recently practised or selected for the next session.
            </Text>
          </Card>

          <Card className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricIcon}>
                <PersonHeartRegular />
              </span>
              <Text className={styles.metricTitle}>Last review</Text>
            </div>
            <Text className={styles.metricValue}>{formatDateLabel(selectedChild?.last_session_at)}</Text>
            <Text className={styles.metricCaption}>
              Quick reference for follow-up and therapist review.
            </Text>
          </Card>

          <Card className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricIcon}>
                <PersonVoiceRegular />
              </span>
              <Text className={styles.metricTitle}>Active avatar</Text>
            </div>
            <Text className={styles.metricValue}>{selectedAvatarOption.label.split(' (')[0]}</Text>
            <Text className={styles.metricCaption}>
              Paired with {selectedScenarioDetail?.name || 'the chosen exercise'} for the next session.
            </Text>
          </Card>
        </section>

        <section className={styles.lowerGrid}>
          <Card className={styles.listCard}>
            <div className={styles.listHeader}>
              <div>
                <Text className={styles.sectionTitle}>Recent sessions</Text>
              </div>
            </div>

            {loadingSessions ? (
              <div className={styles.emptyState}>
                <Spinner size="small" />
              </div>
            ) : recentSessions.length > 0 ? (
              <div className={styles.sessionList}>
                {recentSessions.map(session => (
                  <div key={session.id} className={styles.sessionItem}>
                    <div className={styles.sessionMeta}>
                      <Text className={styles.sessionTitle}>{session.exercise.name}</Text>
                      <Badge appearance="filled" className={styles.metaBadge}>
                        {formatScore(session.overall_score)}
                      </Badge>
                    </div>
                    <Text className={styles.sessionCaption}>
                      {formatShortDate(session.timestamp)} · {formatExerciseType(session.exercise_metadata?.type || session.exercise.exerciseMetadata?.type)}
                    </Text>
                    <Text className={styles.sessionCaption}>
                      {session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound
                        ? `Target sound: ${session.exercise_metadata?.targetSound || session.exercise.exerciseMetadata?.targetSound}`
                        : 'General guided practice session'}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                Session trends appear here once the child has completed analysed practice sessions.
              </div>
            )}
          </Card>

          <Card className={styles.listCard}>
            <div>
              <Text className={styles.sectionTitle}>Therapist focus</Text>
            </div>
            <div className={styles.badgeRow}>
              <Badge appearance="filled" className={styles.metaBadge}>
                {selectedChild ? selectedChild.name : 'Choose child'}
              </Badge>
              <Badge appearance="tint" className={styles.metaBadge}>
                {selectedScenarioDetail?.name || 'Choose exercise'}
              </Badge>
            </div>
            <Text className={styles.helperText}>{getTrendLabel(sessionSummaries)}</Text>
            {therapistUnlocked ? (
              <Button
                appearance="secondary"
                className={styles.secondaryAction}
                onClick={onOpenTherapistReview}
              >
                Review saved sessions
              </Button>
            ) : (
              <div className={styles.emptyState}>
                Unlock therapist review to open deeper session history and detailed scoring.
              </div>
            )}
          </Card>
        </section>

        <section className={styles.exercisePanel}>
          <ScenarioList
            scenarios={scenarios}
            customScenarios={customScenarios}
            selectedScenario={selectedScenario}
            onSelect={onSelectScenario}
            onAddCustomScenario={onAddCustomScenario}
            onUpdateCustomScenario={onUpdateCustomScenario}
            onDeleteCustomScenario={onDeleteCustomScenario}
            title="Recommended exercises"
            helperText="Choose from the standard exercise library below, then review or create therapist-authored activities in the section underneath."
            showFooter={false}
          />
        </section>
      </div>
    </div>
    </div>
  )
}