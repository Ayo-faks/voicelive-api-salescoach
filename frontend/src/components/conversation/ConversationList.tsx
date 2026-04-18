import type { ReactNode } from 'react'
import { Text } from '@fluentui/react-components'
import { ConversationTurn, type ConversationTurnProps } from './ConversationTurn'
import { useConversationStyles } from './conversationStyles'

export interface ConversationListProps {
  turns: ConversationTurnProps[]
  emptyTitle?: string
  emptyBody?: ReactNode
  ariaLabel?: string
  /**
   * Live sessions scroll newest-first via column-reverse; review surfaces
   * render oldest-first. Default: oldest-first.
   */
  ordering?: 'oldest-first' | 'newest-first'
}

export function ConversationList({
  turns,
  emptyTitle,
  emptyBody,
  ariaLabel = 'Conversation transcript',
  ordering = 'oldest-first',
}: ConversationListProps) {
  const styles = useConversationStyles()

  if (turns.length === 0) {
    return (
      <output className={styles.empty} aria-label={ariaLabel}>
        {emptyTitle ? (
          <Text size={400} weight="semibold">
            {emptyTitle}
          </Text>
        ) : null}
        {emptyBody ? typeof emptyBody === 'string' ? <Text size={300}>{emptyBody}</Text> : emptyBody : null}
      </output>
    )
  }

  const ordered = ordering === 'newest-first' ? turns.slice().reverse() : turns

  return (
    <ul className={styles.list} aria-label={ariaLabel} aria-live="polite">
      {ordered.map((turn, index) => {
        const contentKey =
          typeof turn.content === 'string' ? turn.content.slice(0, 24) : ''
        return (
          <ConversationTurn
            key={`${turn.role}-${index}-${turn.actorName}-${contentKey}`}
            {...turn}
          />
        )
      })}
    </ul>
  )
}
