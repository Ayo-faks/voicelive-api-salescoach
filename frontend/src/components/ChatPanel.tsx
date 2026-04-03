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
  ChartBarIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import type { CustomScenario, Message, Scenario } from '../types'

const useStyles = makeStyles({
  card: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border-strong)',
    backgroundColor: 'rgba(255, 251, 244, 0.92)',
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
    gap: 'var(--space-xs)',
    paddingBottom: 'var(--space-sm)',
    borderBottom: '1px solid var(--color-border)',
  },
  eyebrow: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.28rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  headerDescription: {
    color: 'var(--color-text-secondary)',
    maxWidth: '58ch',
    fontSize: '0.84rem',
    lineHeight: 1.55,
  },
  compactHeader: {
    display: 'grid',
    gap: '8px',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  compactHeaderTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '0.9rem',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  compactHeaderMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
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
  compactChip: {
    minHeight: '22px',
    paddingInline: '10px',
    borderRadius: '0px',
    backgroundColor: 'rgba(13, 138, 132, 0.1)',
    color: 'var(--color-primary-dark)',
    fontSize: '0.6875rem',
    letterSpacing: '0.01em',
  },
  messagesPanel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255,255,255,0.78)',
    overflow: 'hidden',
    '@media (max-width: 720px)': {
      minHeight: '280px',
    },
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    minHeight: '360px',
    padding: 'var(--space-md)',
    display: 'flex',
    flexDirection: 'column-reverse',
    gap: 'var(--space-sm)',
    '@media (max-width: 720px)': {
      minHeight: '240px',
      padding: 'var(--space-sm)',
      gap: '8px',
    },
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
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    maxWidth: '92%',
    fontSize: '0.875rem',
    lineHeight: 1.45,
    border: '1px solid var(--color-border)',
    '@media (max-width: 720px)': {
      maxWidth: '100%',
      padding: '9px 11px',
    },
  },
  messageContent: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  userMessage: {
    backgroundColor: 'rgba(242, 233, 216, 0.62)',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: 'rgba(13, 138, 132, 0.08)',
    alignSelf: 'flex-start',
  },
  streamingCursor: {
    width: '8px',
    height: '1em',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'currentColor',
    opacity: 0.45,
    animationName: {
      '0%': { opacity: 0.2 },
      '50%': { opacity: 0.85 },
      '100%': { opacity: 0.2 },
    },
    animationDuration: '1s',
    animationIterationCount: 'infinite',
  },
  controls: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    padding: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
    backgroundColor: 'rgba(255,255,255,0.7)',
    '@media (max-width: 640px)': {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '8px',
      padding: '10px',
    },
  },
  actionButton: {
    minHeight: '34px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    fontSize: '0.78rem',
    border: '1px solid var(--color-border)',
    '@media (max-width: 640px)': {
      width: '100%',
      minHeight: '38px',
    },
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: '0 var(--space-md) var(--space-md)',
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    lineHeight: 1.4,
    '@media (max-width: 640px)': {
      padding: '9px 10px 10px',
    },
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
  processing?: boolean
  connected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  connectionMessage: string
  introComplete?: boolean
  sessionFinished?: boolean
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
  processing = false,
  connected,
  connectionState,
  connectionMessage,
  introComplete = true,
  sessionFinished = false,
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
  const exerciseType = formatExerciseType(
    customScenario?.scenarioData.exerciseType || scenario?.exerciseMetadata?.type
  )
  const statusText =
    sessionFinished && audience === 'child'
      ? 'Practice finished. Go home when you are ready.'
      : connectionMessage
  const targetSound =
    customScenario?.scenarioData.targetSound || scenario?.exerciseMetadata?.targetSound
  const difficulty =
    customScenario?.scenarioData.difficulty || scenario?.exerciseMetadata?.difficulty
  const compactMeta = [
    exerciseType,
    targetSound ? `Sound: ${targetSound}` : null,
    difficulty,
  ].filter(Boolean)

  const messagesPanel = (
    <div className={styles.messagesPanel}>
      <div className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.placeholder}>
            <Text size={400} weight="semibold">
              {sessionFinished && audience === 'child'
                ? 'Practice finished'
                : !introComplete
                ? audience === 'therapist'
                  ? 'Opening welcome'
                  : 'Your buddy is saying hello'
                : 'Ready when you are'}
            </Text>
            <Text size={300}>
              {sessionFinished && audience === 'child'
                ? 'Your last word feedback stays visible until you leave this screen.'
                : !introComplete
                ? audience === 'therapist'
                  ? 'The avatar is greeting the session now. The dock microphone will unlock right after the welcome.'
                  : 'Listen for the welcome, then the microphone will unlock.'
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
                <div className={styles.messageContent}>
                  <Text size={300}>{msg.content}</Text>
                  {msg.streaming ? <span className={styles.streamingCursor} /> : null}
                </div>
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
              icon={<TrashIcon className="w-5 h-5" />}
              onClick={onClear}
            >
              {audience === 'child' ? 'Finish practice' : 'Clear session'}
            </Button>
          ) : null}

          {showAnalyzeControl ? (
            <Button
              appearance="primary"
              className={styles.actionButton}
              icon={<ChartBarIcon className="w-5 h-5" />}
              onClick={onAnalyze}
              disabled={!canAnalyze}
            >
              Session summary
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.status}>
        <Text size={200}>{statusText}</Text>
      </div>
    </div>
  )

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <Text className={styles.eyebrow}>Session transcript</Text>
        <Text className={styles.title} size={700} weight="semibold" block>
          Session Transcript
        </Text>
        <Text size={300} block className={styles.headerDescription}>
          Follow the live conversation as it unfolds and keep the session controls within reach.
        </Text>
      </div>

      {scenario ? (
        <div className={styles.compactHeader}>
          <Text className={styles.compactHeaderTitle} size={500} weight="semibold">
            {scenario.name}
          </Text>
          {compactMeta.length > 0 ? (
            <div className={styles.compactHeaderMeta}>
              {compactMeta.map(item => (
                <span key={item} className={mergeClasses(styles.exerciseChip, styles.compactChip)}>
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {messagesPanel}
    </Card>
  )
}
