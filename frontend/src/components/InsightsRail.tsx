/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import type {
  InsightsAskResponse,
  InsightsCitation,
  InsightsConversation,
  InsightsMessage,
  InsightsScope,
  InsightsScopeType,
  InsightsVoiceState,
} from '../types'
import { api } from '../services/api'
import { VisualizationBlock } from './VisualizationBlock'
import { InsightsOrb } from './InsightsOrb'

const SCOPE_LABELS: Record<InsightsScopeType, string> = {
  caseload: 'Caseload',
  child: 'This child',
  session: 'This session',
  report: 'This report',
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: '320px',
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  scopeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  chip: {
    padding: '4px 10px',
    borderRadius: '999px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    background: tokens.colorNeutralBackground2,
    cursor: 'pointer',
  },
  chipActive: {
    background: tokens.colorBrandBackground2,
    borderTopColor: tokens.colorBrandStroke2,
    borderRightColor: tokens.colorBrandStroke2,
    borderBottomColor: tokens.colorBrandStroke2,
    borderLeftColor: tokens.colorBrandStroke2,
    color: tokens.colorBrandForeground1,
  },
  chipDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  composer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  answer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingTop: '8px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  answerText: {
    whiteSpace: 'pre-wrap',
    fontSize: tokens.fontSizeBase300,
  },
  citations: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  citationChip: {
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: tokens.fontSizeBase100,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  history: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '8px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  historyItem: {
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  historyItemActive: {
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
})

export interface InsightsRailProps {
  currentScope: InsightsScope
  availableScopes?: InsightsScopeType[]
  onScopeChange?: (next: InsightsScope) => void
  /**
   * When this number changes, the composer textarea receives focus. Use it
   * from “Ask about this” launchers to draw the therapist's attention to
   * the rail after the scope has been pre-filled.
   */
  focusToken?: number
  /** Optional: used only for visual default chip ordering; logic purely based on currentScope. */
  className?: string
  /**
   * Optional voice-state driving the rail orb. When provided the orb is
   * rendered above the composer; omitting it hides the orb entirely.
   */
  voiceState?: InsightsVoiceState
  /** Microphone input level 0..1 used by the orb while `voiceState === 'listening'`. */
  inputLevel?: number
  /** TTS output level 0..1 used by the orb while `voiceState === 'speaking'`. */
  outputLevel?: number
}

function citationLabel(c: InsightsCitation): string {
  if (c.label) return c.label
  if (c.report_id) return `Report ${c.report_id.slice(0, 8)}`
  if (c.session_id) return `Session ${c.session_id.slice(0, 8)}`
  if (c.plan_id) return `Plan ${c.plan_id.slice(0, 8)}`
  if (c.memory_item_id) return `Memory ${c.memory_item_id.slice(0, 8)}`
  if (c.child_id) return `Child ${c.child_id.slice(0, 8)}`
  return c.kind
}

export function InsightsRail({
  currentScope,
  availableScopes,
  onScopeChange,
  focusToken,
  className,
  voiceState,
  inputLevel,
  outputLevel,
}: InsightsRailProps) {
  const styles = useStyles()
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<InsightsMessage | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InsightsConversation[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusTokenRef = useRef<number | undefined>(focusToken)

  useEffect(() => {
    if (focusToken === undefined) return
    // Only focus on actual focusToken changes, not the first render.
    if (focusTokenRef.current === focusToken) return
    focusTokenRef.current = focusToken
    // Fluent UI Textarea forwards ref to the root span in some versions;
    // locate the inner <textarea> defensively before calling focus().
    const node = textareaRef.current
    if (!node) return
    if (node.tagName === 'TEXTAREA') {
      node.focus()
      return
    }
    const inner = (node as unknown as HTMLElement).querySelector?.('textarea')
    if (inner instanceof HTMLTextAreaElement) inner.focus()
  }, [focusToken])

  const scopeOptions: InsightsScopeType[] =
    availableScopes && availableScopes.length > 0
      ? availableScopes
      : ['caseload', 'child', 'session', 'report']

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.listInsightsConversations(20)
      setConversations(res.conversations || [])
    } catch {
      // silent — history is non-critical
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleSend = useCallback(async () => {
    const trimmed = message.trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError(null)
    try {
      const res: InsightsAskResponse = await api.askInsights({
        message: trimmed,
        scope: currentScope,
        conversationId,
      })
      setAnswer(res.assistant_message)
      setConversationId(res.conversation.id)
      setMessage('')
      void loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [message, loading, currentScope, conversationId, loadHistory])

  const handleOpenConversation = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getInsightsConversation(id)
      const lastAssistant = [...res.messages]
        .reverse()
        .find(m => m.role === 'assistant')
      setConversationId(res.conversation.id)
      setAnswer(lastAssistant || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleScopeClick = (type: InsightsScopeType) => {
    if (!onScopeChange) return
    const next: InsightsScope = { type }
    if (type === 'child' || type === 'session' || type === 'report') {
      if (currentScope.child_id) next.child_id = currentScope.child_id
    }
    if (type === 'session' && currentScope.session_id) {
      next.session_id = currentScope.session_id
    }
    if (type === 'report' && currentScope.report_id) {
      next.report_id = currentScope.report_id
    }
    onScopeChange(next)
  }

  const isScopeDisabled = (type: InsightsScopeType): boolean => {
    if (type === 'child') return !currentScope.child_id
    if (type === 'session') return !currentScope.session_id
    if (type === 'report') return !currentScope.report_id
    return false
  }

  return (
    <aside
      className={mergeClasses(styles.root, className)}
      data-testid="insights-rail"
      aria-label="Insights agent rail"
    >
      {voiceState ? (
        <InsightsOrb
          state={voiceState}
          inputLevel={inputLevel}
          outputLevel={outputLevel}
        />
      ) : null}
      <div className={styles.heading}>
        <Text weight="semibold">Ask your data</Text>
        <Text size={200}>Questions are scoped to what you can see.</Text>
      </div>
      <fieldset className={styles.scopeRow} aria-label="Insights scope" style={{ border: 'none', padding: 0, margin: 0 }}>
        {scopeOptions.map(type => {
          const active = currentScope.type === type
          const disabled = isScopeDisabled(type)
          return (
            <button
              key={type}
              type="button"
              className={mergeClasses(
                styles.chip,
                active && styles.chipActive,
                disabled && styles.chipDisabled,
              )}
              onClick={() => !disabled && handleScopeClick(type)}
              aria-pressed={active}
              disabled={disabled}
              data-testid={`insights-rail-scope-${type}`}
            >
              {SCOPE_LABELS[type]}
            </button>
          )
        })}
      </fieldset>

      <div className={styles.composer}>
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(_, data) => setMessage(data.value)}
          placeholder="Ask about progress, patterns, or evidence…"
          rows={3}
          disabled={loading}
          data-testid="insights-rail-input"
        />
        <div className={styles.actions}>
          <Button
            appearance="primary"
            onClick={() => void handleSend()}
            disabled={loading || !message.trim()}
            data-testid="insights-rail-send"
          >
            {loading ? <Spinner size="tiny" /> : 'Ask'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className={styles.error} role="alert" data-testid="insights-rail-error">
          {error}
        </div>
      ) : null}

      {answer ? (
        <div className={styles.answer} data-testid="insights-rail-answer">
          <Text className={styles.answerText}>
            {answer.content_text || '(no answer)'}
          </Text>
          {answer.visualizations && answer.visualizations.length > 0 ? (
            <div data-testid="insights-rail-visualizations">
              {answer.visualizations.map((v, idx) => (
                <VisualizationBlock key={`${answer.id}-viz-${idx}`} spec={v} />
              ))}
            </div>
          ) : null}
          {answer.citations && answer.citations.length > 0 ? (
            <div
              className={styles.citations}
              data-testid="insights-rail-citations"
              aria-label="Citations"
            >
              {answer.citations.map((c, idx) => (
                <span key={`${answer.id}-cit-${idx}`} className={styles.citationChip}>
                  {citationLabel(c)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {conversations.length > 0 ? (
        <div className={styles.history} aria-label="Previous conversations">
          <Text size={200} weight="semibold">
            History
          </Text>
          {conversations.slice(0, 5).map(c => (
            <button
              key={c.id}
              type="button"
              className={mergeClasses(
                styles.historyItem,
                c.id === conversationId && styles.historyItemActive,
              )}
              onClick={() => void handleOpenConversation(c.id)}
              data-testid="insights-rail-history-item"
            >
              {c.title || `${SCOPE_LABELS[c.scope_type] ?? c.scope_type} · ${c.updated_at.slice(0, 10)}`}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

export default InsightsRail
