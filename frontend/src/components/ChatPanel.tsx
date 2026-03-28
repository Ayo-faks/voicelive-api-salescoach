/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Card,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import {
  ChartMultipleRegular,
  DeleteRegular,
  MicOffRegular,
  MicRegular,
} from '@fluentui/react-icons'
import type { CustomScenario, Message, Scenario } from '../types'

const useStyles = makeStyles({
  card: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
    gap: 'var(--space-lg)',
    '@media (max-width: 720px)': {
      padding: 'var(--space-md)',
      gap: 'var(--space-md)',
    },
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.1rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
  },
  headerDescription: {
    color: 'var(--color-text-secondary)',
    maxWidth: '720px',
    fontSize: '0.8125rem',
  },
  exerciseMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '4px',
  },
  exerciseChip: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '26px',
    paddingInline: 'var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
    fontFamily: 'var(--font-display)',
    fontSize: '0.75rem',
    fontWeight: '500',
  },
  sessionBody: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 0.7fr) minmax(260px, 0.3fr)',
    gap: 'var(--space-lg)',
    flex: 1,
    minHeight: 0,
    '@media (max-width: 960px)': {
      gridTemplateColumns: '1fr',
    },
  },
  heroPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-md)',
    padding: 'var(--space-xl)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-muted)',
    border: '1px solid var(--color-border)',
    minHeight: '380px',
    textAlign: 'center',
    position: 'relative',
    overflow: 'hidden',
    '@media (max-width: 720px)': {
      minHeight: 'unset',
      padding: 'var(--space-lg)',
    },
  },
  connectionBanner: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-warning-soft)',
    border: '1px solid rgba(224, 146, 62, 0.2)',
    color: 'var(--color-text-primary)',
    fontSize: '0.8125rem',
  },
  heroHint: {
    color: 'var(--color-text-tertiary)',
    maxWidth: '360px',
    lineHeight: 1.5,
    fontSize: '0.8125rem',
  },
  micButton: {
    position: 'relative',
    width: '120px',
    height: '120px',
    minWidth: '120px',
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
    color: 'var(--color-text-inverse)',
    boxShadow: '0 14px 28px rgba(13, 138, 132, 0.22)',
    transition:
      'transform var(--transition-normal), box-shadow var(--transition-normal), background-color var(--transition-normal)',
    '&:hover': {
      transform: 'scale(1.03)',
    },
    '&:active': {
      transform: 'scale(0.97)',
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: '-12px',
      borderRadius: '50%',
      border: '2px solid transparent',
      opacity: 0,
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: '-24px',
      borderRadius: '50%',
      border: '2px solid transparent',
      opacity: 0,
    },
    '@media (max-width: 640px)': {
      width: '100px',
      height: '100px',
      minWidth: '100px',
    },
  },
  micButtonActive: {
    background: 'linear-gradient(135deg, var(--color-primary-dark), var(--color-primary))',
    boxShadow: '0 14px 28px rgba(13, 138, 132, 0.28), 0 0 0 18px rgba(13, 138, 132, 0.08)',
    '&::before': {
      opacity: 1,
      border: '2px solid rgba(13, 138, 132, 0.4)',
      animationName: {
        '0%': { transform: 'scale(0.95)', opacity: 0.6 },
        '100%': { transform: 'scale(1.2)', opacity: 0 },
      },
      animationDuration: '2s',
      animationIterationCount: 'infinite',
    },
    '&::after': {
      opacity: 1,
      border: '2px solid rgba(13, 138, 132, 0.25)',
      animationName: {
        '0%': { transform: 'scale(0.9)', opacity: 0.4 },
        '100%': { transform: 'scale(1.3)', opacity: 0 },
      },
      animationDuration: '2s',
      animationDelay: '0.4s',
      animationIterationCount: 'infinite',
    },
  },
  micLabel: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1rem',
    fontWeight: '600',
  },
  micSubLabel: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.8125rem',
  },
  messagesPanel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--color-bg-card)',
    overflow: 'hidden',
    '@media (max-width: 720px)': {
      minHeight: '280px',
    },
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    minHeight: '280px',
    padding: 'var(--space-md)',
    display: 'flex',
    flexDirection: 'column-reverse',
    gap: 'var(--space-sm)',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    minHeight: '100%',
    color: 'var(--color-text-tertiary)',
  },
  message: {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    maxWidth: '88%',
    fontSize: '0.875rem',
  },
  userMessage: {
    backgroundColor: 'var(--color-secondary-soft)',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: 'var(--color-primary-soft)',
    alignSelf: 'flex-start',
  },
  controls: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    padding: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-secondary)',
    '@media (max-width: 640px)': {
      gap: 'var(--space-xs)',
    },
  },
  actionButton: {
    minHeight: '36px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.8125rem',
    border: '1px solid var(--color-border)',
    '@media (max-width: 640px)': {
      flex: 1,
      minHeight: '40px',
    },
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: '0 var(--space-md) var(--space-sm)',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
})

function formatExerciseType(value?: string) {
  if (!value) return null

  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface Props {
  messages: Message[]
  recording: boolean
  connected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  connectionMessage: string
  introComplete?: boolean
  canAnalyze: boolean
  onToggleRecording: () => void
  onClear: () => void
  onAnalyze: () => void
  scenario?: Scenario | CustomScenario | null
  audience?: 'therapist' | 'child'
  showClearControl?: boolean
  showAnalyzeControl?: boolean
}

function isCustomScenario(
  scenario: Scenario | CustomScenario | null | undefined
): scenario is CustomScenario {
  return Boolean(scenario && 'scenarioData' in scenario)
}

export function ChatPanel({
  messages,
  recording,
  connected,
  connectionState,
  connectionMessage,
  introComplete = true,
  canAnalyze,
  onToggleRecording,
  onClear,
  onAnalyze,
  scenario,
  audience = 'therapist',
  showClearControl = true,
  showAnalyzeControl = true,
}: Props) {
  const styles = useStyles()
  const customScenario = isCustomScenario(scenario) ? scenario : null
  const canTalk = connected && introComplete
  const exerciseType = formatExerciseType(
    customScenario?.scenarioData.exerciseType || scenario?.exerciseMetadata?.type
  )
  const subLabel =
    !introComplete && audience === 'child'
      ? 'Listen to your buddy first. The microphone will open right after the welcome.'
      : audience === 'child'
      ? 'Press the microphone when you are ready to speak.'
      : 'Press the microphone when the child is ready to speak.'

  return (
    <Card className={styles.card}>
      {scenario && (
        <div className={styles.header}>
          <Text className={styles.title} size={700} weight="semibold" block>
            {scenario.name}
          </Text>
          <Text size={300} block className={styles.headerDescription}>
            {scenario.description || 'Let\'s practice together.'}
          </Text>
          <div className={styles.exerciseMeta}>
            {exerciseType && (
              <span className={styles.exerciseChip}>{exerciseType}</span>
            )}
            {scenario.exerciseMetadata?.targetSound && (
              <span className={styles.exerciseChip}>
                Sound: {scenario.exerciseMetadata.targetSound}
              </span>
            )}
            {customScenario?.scenarioData.targetSound && (
              <span className={styles.exerciseChip}>
                Sound: {customScenario.scenarioData.targetSound}
              </span>
            )}
            {scenario.exerciseMetadata?.difficulty && (
              <span className={styles.exerciseChip}>
                {scenario.exerciseMetadata.difficulty}
              </span>
            )}
            {customScenario?.scenarioData.difficulty && (
              <span className={styles.exerciseChip}>
                {customScenario.scenarioData.difficulty}
              </span>
            )}
          </div>
        </div>
      )}

      <div className={styles.sessionBody}>
        <div className={styles.heroPanel}>
          {connectionState !== 'connected' && (
            <div className={styles.connectionBanner}>
              <Text size={300} weight="semibold">
                {connectionMessage}
              </Text>
            </div>
          )}
          <Button
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            appearance="transparent"
            className={mergeClasses(
              styles.micButton,
              recording && styles.micButtonActive
            )}
            icon={recording ? <MicOffRegular fontSize={44} /> : <MicRegular fontSize={44} />}
            onClick={onToggleRecording}
            disabled={!canTalk}
          />
          <Text className={styles.micLabel} size={700} weight="semibold">
            {recording
              ? 'Listening now...'
              : !introComplete && audience === 'child'
                ? 'Listen to your buddy'
                : 'Tap to talk!'}
          </Text>
          <Text className={styles.micSubLabel} size={300}>
            {recording
              ? 'Say the words clearly and take your time.'
              : subLabel}
          </Text>
          <Text className={styles.heroHint} size={300}>
            Keep the session calm and brief. The practice buddy will respond in
            short, friendly prompts.
          </Text>
        </div>

        <div className={styles.messagesPanel}>
          <div className={styles.messages}>
            {messages.length === 0 ? (
              <div className={styles.placeholder}>
                <Text size={400} weight="semibold">
                  {!introComplete && audience === 'child'
                    ? 'Your buddy is saying hello'
                    : 'Ready when you are'}
                </Text>
                <Text size={300}>
                  {!introComplete && audience === 'child'
                    ? 'Listen for the welcome, then the microphone will unlock.'
                    : 'Tap the microphone to begin the exercise.'}
                </Text>
              </div>
            ) : (
              messages
                .slice()
                .reverse()
                .map(msg => (
                  <div
                    key={msg.id}
                    className={mergeClasses(
                      styles.message,
                      msg.role === 'user'
                        ? styles.userMessage
                        : styles.assistantMessage
                    )}
                  >
                    <Text size={300}>{msg.content}</Text>
                  </div>
                ))
            )}
          </div>

          {showClearControl || showAnalyzeControl ? (
            <div className={styles.controls}>
              {showClearControl ? (
                <Button
                  appearance="secondary"
                  className={styles.actionButton}
                  icon={<DeleteRegular />}
                  onClick={onClear}
                >
                  {audience === 'child' ? 'Start over' : 'Clear session'}
                </Button>
              ) : null}

              {showAnalyzeControl ? (
                <Button
                  appearance="primary"
                  className={styles.actionButton}
                  icon={<ChartMultipleRegular />}
                  onClick={onAnalyze}
                  disabled={!canAnalyze}
                >
                  Your results
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.status}>
            <Text size={200}>{connectionMessage}</Text>
          </div>
        </div>
      </div>
    </Card>
  )
}
