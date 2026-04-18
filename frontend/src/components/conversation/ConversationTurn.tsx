import { Text, mergeClasses } from '@fluentui/react-components'
import type { ReactNode } from 'react'
import { useConversationStyles } from './conversationStyles'

export type ConversationTurnRole = 'child' | 'buddy' | 'system'
export type ConversationVerdict = 'correct' | 'retry' | 'off-target'

export interface ConversationTurnProps {
  role: ConversationTurnRole
  actorName: string
  content: ReactNode
  timestamp?: string | Date | null
  streaming?: boolean
  verdict?: ConversationVerdict
  targetPhoneme?: string
}

function formatTimestamp(timestamp?: string | Date | null): string | null {
  if (!timestamp) return null
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const VERDICT_COPY: Record<ConversationVerdict, string> = {
  correct: 'On target',
  retry: 'Retry',
  'off-target': 'Off target',
}

export function ConversationTurn({
  role,
  actorName,
  content,
  timestamp,
  streaming,
  verdict,
  targetPhoneme,
}: ConversationTurnProps) {
  const styles = useConversationStyles()
  const label = formatTimestamp(timestamp)

  const avatarClass = mergeClasses(
    styles.avatar,
    role === 'child' && styles.avatarChild,
    role === 'system' && styles.avatarSystem,
  )

  const bodyClass = mergeClasses(
    styles.body,
    role === 'system' && styles.bodySystem,
  )

  return (
    <li
      className={styles.turn}
      aria-label={typeof content === 'string' ? `${actorName}: ${content}` : actorName}
    >
      <span className={avatarClass} aria-hidden="true">
        {initials(actorName)}
      </span>
      <div className={styles.meta}>
        <Text className={styles.actor}>{actorName}</Text>
        {label ? <Text className={styles.timestamp}>{label}</Text> : null}
      </div>
      <div className={bodyClass}>
        <span className={styles.inlineContent}>
          {typeof content === 'string' ? <span>{content}</span> : content}
          {streaming ? <span className={styles.streamingCursor} aria-hidden="true" /> : null}
        </span>
      </div>
      {(verdict || targetPhoneme) ? (
        <div className={styles.verdictRow}>
          {verdict ? (
            <span
              className={mergeClasses(
                styles.verdictChip,
                verdict === 'correct' && styles.verdictCorrect,
                verdict === 'retry' && styles.verdictRetry,
                verdict === 'off-target' && styles.verdictOffTarget,
              )}
            >
              {VERDICT_COPY[verdict]}
            </span>
          ) : null}
          {targetPhoneme ? (
            <span className={mergeClasses(styles.verdictChip, styles.phonemeChip)}>
              /{targetPhoneme}/
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
