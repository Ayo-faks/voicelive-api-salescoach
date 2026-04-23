/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { MicrophoneIcon } from '@heroicons/react/24/outline'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  InsightsAskResponse,
  InsightsCitation,
  InsightsConversation,
  InsightsMessage,
  InsightsScope,
  InsightsScopeType,
  InsightsVoiceMode,
} from '../types'
import { api } from '../services/api'
import { InsightsOrb } from './InsightsOrb'
import { VisualizationBlock } from './VisualizationBlock'
import {
  useInsightsVoice,
  type UseInsightsVoiceTurnCompleted,
} from '../hooks/useInsightsVoice'

const SCOPE_LABELS: Record<InsightsScopeType, string> = {
  caseload: 'Caseload',
  child: 'This child',
  session: 'This session',
  report: 'This report',
}

const RAIL_MODE_STORAGE_KEY = 'wulo.insightsRail.mode'
const COMPOSER_MIN_HEIGHT = 22
const COMPOSER_MAX_HEIGHT = 180

export type InsightsRailMode = 'collapsed' | 'normal' | 'full'

export function readStoredInsightsRailMode(): InsightsRailMode {
  if (typeof window === 'undefined') return 'normal'
  try {
    const raw = window.localStorage.getItem(RAIL_MODE_STORAGE_KEY)
    if (raw === 'collapsed' || raw === 'normal' || raw === 'full') return raw
  } catch {
    /* ignore */
  }
  return 'normal'
}

function readStoredMode(): InsightsRailMode {
  return readStoredInsightsRailMode()
}

function normalizeInsightsVoiceMode(mode: InsightsVoiceMode): InsightsVoiceMode {
  return mode === 'push_to_talk' ? 'full_duplex' : mode
}

function persistMode(mode: InsightsRailMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RAIL_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    padding: '0',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04), 0 8px 24px rgba(15, 42, 58, 0.06)',
    minWidth: '320px',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    maxHeight: 'calc(100vh - 48px)',
    fontFeatureSettings: '"ss01", "cv11"',
  },
  rootFull: {
    position: 'absolute',
    inset: '0',
    zIndex: 20,
    minWidth: 0,
    boxShadow: '0 12px 40px rgba(15, 42, 58, 0.12)',
    borderRadius: tokens.borderRadiusXLarge,
    maxHeight: 'calc(100vh - 32px)',
    height: 'calc(100vh - 32px)',
  },
  rootCollapsed: {
    minWidth: 0,
    minHeight: '188px',
    height: 'auto',
    maxHeight: 'none',
    padding: '10px 8px',
    gap: '10px',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '56px',
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04), 0 8px 24px rgba(15, 42, 58, 0.06)',
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorBrandStroke2}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px 12px',
    background: 'linear-gradient(180deg, rgba(250,252,252,0.96), rgba(240,247,247,0.92))',
    borderBottom: '1px solid rgba(15,42,58,0.06)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(15,42,58,0.04)',
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  menuTrigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: tokens.borderRadiusMedium,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    transition: 'box-shadow 120ms ease, background 120ms ease, border-color 120ms ease',
    ':hover': {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,250,250,0.85))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.08)',
      border: '1px solid rgba(15,42,58,0.08)',
    },
  },
  iconButton: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    padding: '6px 8px',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    lineHeight: 1,
    transition: 'box-shadow 120ms ease, background 120ms ease, border-color 120ms ease',
    ':hover': {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,250,250,0.85))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.08)',
      border: '1px solid rgba(15,42,58,0.08)',
      color: tokens.colorNeutralForeground1,
    },
    ':active': {
      boxShadow: 'inset 0 1px 1px rgba(15,42,58,0.1)',
    },
  },
  menuLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    padding: '6px 12px 2px',
  },
  menuEmpty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    padding: '8px 12px 12px',
  },
  collapsedLauncher: {
    display: 'flex',
    alignSelf: 'stretch',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: '112px',
    background: 'transparent',
    border: `1px dashed ${tokens.colorBrandStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    cursor: 'pointer',
    padding: '12px 6px',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.02em',
    color: tokens.colorBrandForeground1,
  },
  collapsedEyebrow: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: tokens.colorBrandForeground2,
  },
  collapsedLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
    textAlign: 'center',
  },
  collapsedHint: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  collapsedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '30px',
    minHeight: '30px',
    borderRadius: '999px',
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '0.08em',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  scopeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  chip: {
    padding: '4px 12px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    letterSpacing: '-0.01em',
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04)',
    transitionProperty: 'background-color, color, border-color, box-shadow',
    transitionDuration: '140ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    ':hover': {
      background: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
      boxShadow: '0 2px 6px rgba(15, 42, 58, 0.08)',
    },
  },
  chipActive: {
    background: 'rgba(13, 138, 132, 0.1)',
    borderTopColor: '#0d8a84',
    borderRightColor: '#0d8a84',
    borderBottomColor: '#0d8a84',
    borderLeftColor: '#0d8a84',
    color: '#0d8a84',
    boxShadow: '0 0 0 1px rgba(13, 138, 132, 0.25)',
  },
  chipDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  transcript: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  messageRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxWidth: '92%',
  },
  messageRowUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageRowAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  messageMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  messageRoleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '20px',
    padding: '0 8px',
    borderRadius: tokens.borderRadiusCircular,
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  messageRoleBadgeUser: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  messageRoleBadgeAssistant: {
    backgroundColor: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground2,
  },
  messageTimestamp: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
  },
  messageBubble: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04)',
    letterSpacing: '-0.01em',
  },
  messageBubbleUser: {
    backgroundColor: tokens.colorBrandBackground2,
    borderTopColor: tokens.colorBrandStroke2,
    borderRightColor: tokens.colorBrandStroke2,
    borderBottomColor: tokens.colorBrandStroke2,
    borderLeftColor: tokens.colorBrandStroke2,
  },
  messageBubbleAssistant: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  markdownContent: {
    display: 'grid',
    gap: '6px',
    color: 'inherit',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  markdownParagraph: {
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere',
  },
  markdownList: {
    margin: 0,
    paddingLeft: '18px',
    display: 'grid',
    gap: '4px',
  },
  markdownListItem: {
    margin: 0,
  },
  markdownCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.92em',
    padding: '1px 4px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  artifactGroup: {
    display: 'grid',
    gap: '6px',
  },
  artifactLabel: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  visualizationStack: {
    display: 'grid',
    gap: '8px',
  },
  citations: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  citationChip: {
    padding: '2px 10px',
    borderRadius: tokens.borderRadiusCircular,
    fontSize: tokens.fontSizeBase100,
    letterSpacing: '-0.01em',
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  suggestionGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: 'auto',
    paddingTop: '8px',
  },
  suggestionChip: {
    display: 'inline-flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    padding: '10px 14px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    letterSpacing: '-0.01em',
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04)',
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, color, box-shadow, transform',
    transitionDuration: '140ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    ':hover': {
      background: tokens.colorNeutralBackground2,
      boxShadow: '0 2px 6px rgba(15, 42, 58, 0.08)',
    },
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  composerWrap: {
    padding: '12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground1,
  },
  composerCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.04)',
    transitionProperty: 'border-color, box-shadow',
    transitionDuration: '160ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    ':focus-within': {
      boxShadow: '0 0 0 3px rgba(13, 138, 132, 0.15)',
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
    },
  },
  composerInput: {
    width: '100%',
    resize: 'none',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    letterSpacing: '-0.01em',
    color: tokens.colorNeutralForeground1,
    padding: '4px 2px',
    minHeight: `${COMPOSER_MIN_HEIGHT}px`,
    maxHeight: `${COMPOSER_MAX_HEIGHT}px`,
    overflowY: 'hidden',
    '::placeholder': {
      color: tokens.colorNeutralForeground4,
      letterSpacing: '-0.01em',
    },
  },
  composerFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  composerTools: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  toolButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase400,
    lineHeight: 1,
    transitionProperty: 'background-color, color, border-color',
    transitionDuration: '140ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    ':hover': {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
  },
  voiceButton: {
    width: '36px',
    height: '36px',
    borderTopColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    borderBottomColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: '0 1px 2px rgba(15, 42, 58, 0.06)',
    ':hover': {
      background: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
    },
  },
  voiceButtonActive: {
    background: tokens.colorBrandBackground2,
    borderTopColor: tokens.colorBrandStroke2,
    borderRightColor: tokens.colorBrandStroke2,
    borderBottomColor: tokens.colorBrandStroke2,
    borderLeftColor: tokens.colorBrandStroke2,
    color: tokens.colorBrandForeground1,
    boxShadow: '0 0 0 1px rgba(13, 138, 132, 0.18)',
  },
  voiceButtonListening: {
    animationName: {
      '0%': { boxShadow: '0 0 0 0 rgba(13, 138, 132, 0.24)' },
      '70%': { boxShadow: '0 0 0 8px rgba(13, 138, 132, 0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(13, 138, 132, 0)' },
    },
    animationDuration: '1400ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-out',
  },
  voiceButtonError: {
    background: tokens.colorPaletteRedBackground1,
    borderTopColor: tokens.colorPaletteRedBorder2,
    borderRightColor: tokens.colorPaletteRedBorder2,
    borderBottomColor: tokens.colorPaletteRedBorder2,
    borderLeftColor: tokens.colorPaletteRedBorder2,
    color: tokens.colorPaletteRedForeground1,
  },
  voiceButtonBusy: {
    cursor: 'wait',
    opacity: 0.85,
  },
  voiceInlineError: {
    maxWidth: '220px',
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorStatusDangerForeground1,
  },

  voiceIcon: {
    width: '18px',
    height: '18px',
    strokeWidth: 1.8,
  },
  sendButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralForeground1}`,
    background: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase400,
    lineHeight: 1,
    boxShadow: '0 2px 6px rgba(15, 42, 58, 0.18)',
    transitionProperty: 'background-color, color, box-shadow, transform',
    transitionDuration: '140ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    ':hover': {
      background: tokens.colorNeutralForeground2,
      boxShadow: '0 3px 10px rgba(15, 42, 58, 0.24)',
    },
    ':disabled': {
      background: tokens.colorNeutralBackground3,
      borderTopColor: tokens.colorNeutralStroke2,
      borderRightColor: tokens.colorNeutralStroke2,
      borderBottomColor: tokens.colorNeutralStroke2,
      borderLeftColor: tokens.colorNeutralStroke2,
      color: tokens.colorNeutralForegroundDisabled,
      boxShadow: 'none',
      cursor: 'not-allowed',
    },
  },
  voiceToggleRow: {
    display: 'flex',
    justifyContent: 'flex-start',
    padding: '0 12px 12px',
    background: tokens.colorNeutralBackground1,
  },
  voiceToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '32px',
    padding: '0 12px',
    borderRadius: tokens.borderRadiusCircular,
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopColor: tokens.colorBrandStroke2,
    borderRightColor: tokens.colorBrandStroke2,
    borderBottomColor: tokens.colorBrandStroke2,
    borderLeftColor: tokens.colorBrandStroke2,
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  voiceToggleActive: {
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  voiceOrbWrap: {
    padding: '0 12px 12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground1,
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
  /** Optional externally requested mode, used when a parent needs to reopen or hide the rail. */
  mode?: InsightsRailMode
  /**
   * Optional initial UI mode. Defaults to the last persisted mode (or
   * `'normal'`). Parents rarely need to set this; prefer `onModeChange`
   * to react to user toggles.
   */
  initialMode?: InsightsRailMode
  /** Fires whenever the user collapses / expands / maximises the rail. */
  onModeChange?: (mode: InsightsRailMode) => void
  insightsVoiceMode?: InsightsVoiceMode
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `insights-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createVoiceMessage(
  role: 'user' | 'assistant',
  conversationId: string,
  contentText: string,
  options?: {
    citations?: InsightsCitation[]
    visualizations?: InsightsMessage['visualizations']
  },
): InsightsMessage {
  return {
    id: createClientMessageId(),
    conversation_id: conversationId,
    role,
    content_text: contentText,
    citations: options?.citations ?? [],
    visualizations: options?.visualizations ?? [],
    tool_trace: [],
    latency_ms: null,
    tool_calls_count: null,
    prompt_version: 'insights-v1',
    error_text: null,
    created_at: new Date().toISOString(),
  }
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

function formatMessageTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function renderMessageContent(content: string, styles: ReturnType<typeof useStyles>) {
  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={styles.markdownParagraph}>{children}</p>,
          ul: ({ children }) => <ul className={styles.markdownList}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.markdownList}>{children}</ol>,
          li: ({ children }) => <li className={styles.markdownListItem}>{children}</li>,
          code: ({ children }) => <code className={styles.markdownCode}>{children}</code>,
          h1: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
          h2: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
          h3: ({ children }) => <p className={styles.markdownParagraph}><strong>{children}</strong></p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function InsightsRail({
  currentScope,
  availableScopes,
  onScopeChange,
  focusToken,
  className,
  mode: requestedMode,
  initialMode,
  onModeChange,
  insightsVoiceMode = 'off',
}: InsightsRailProps) {
  const styles = useStyles()
  const defaultVoiceErrorText = 'Microphone blocked - allow access in your browser to use voice.'
  const [mode, setMode] = useState<InsightsRailMode>(() => requestedMode ?? initialMode ?? readStoredMode())

  useEffect(() => {
    if (!requestedMode) return
    setMode(prev => (prev === requestedMode ? prev : requestedMode))
  }, [requestedMode])

  const changeMode = useCallback(
    (next: InsightsRailMode) => {
      setMode(next)
      persistMode(next)
      onModeChange?.(next)
    },
    [onModeChange],
  )
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<InsightsMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InsightsConversation[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusTokenRef = useRef<number | undefined>(focusToken)

  const suggestionPrompts = useMemo<string[]>(() => {
    switch (currentScope.type) {
      case 'session':
        return [
          'Summarise this session',
          'What should we work on next?',
        ]
      case 'report':
        return [
          'Summarise this report',
          'Highlight the key changes',
        ]
      case 'child':
        return [
          'How is this child progressing?',
          'What patterns stand out recently?',
        ]
      default:
        return [
          'Who needs attention this week?',
          'Summarise recent progress across my caseload',
        ]
    }
  }, [currentScope.type])

  const focusComposer = useCallback(() => {
    const node = textareaRef.current
    if (node instanceof HTMLTextAreaElement) {
      node.focus()
      return
    }

    const inner = (node as unknown as HTMLElement | null)?.querySelector?.('textarea')
    if (inner instanceof HTMLTextAreaElement) {
      inner.focus()
    }
  }, [])

  useEffect(() => {
    if (focusToken === undefined) return
    // Only focus on actual focusToken changes, not the first render.
    if (focusTokenRef.current === focusToken) return
    focusTokenRef.current = focusToken
    focusComposer()
  }, [focusComposer, focusToken])

  const syncComposerHeight = useCallback(() => {
    const node = textareaRef.current
    if (!(node instanceof HTMLTextAreaElement)) return
    node.style.height = '0px'
    const measuredHeight = Math.max(node.scrollHeight, COMPOSER_MIN_HEIGHT)
    const nextHeight = Math.min(measuredHeight, COMPOSER_MAX_HEIGHT)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = measuredHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    syncComposerHeight()
  })

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

  const handleVoiceCompleted = useCallback(
    (payload: UseInsightsVoiceTurnCompleted) => {
      const resolvedConversationId = payload.conversationId || conversationId || createClientMessageId()
      const nextMessages: InsightsMessage[] = []
      if (payload.transcript.trim()) {
        nextMessages.push(createVoiceMessage('user', resolvedConversationId, payload.transcript))
      }
      nextMessages.push(
        createVoiceMessage('assistant', resolvedConversationId, payload.answerText, {
          citations: payload.citations,
          visualizations: payload.visualizations,
        }),
      )
      setConversationId(resolvedConversationId)
      setMessages(prev => [...prev, ...nextMessages])
      void loadHistory()
    },
    [conversationId, loadHistory],
  )

  const handleSend = useCallback(async (override?: string) => {
    const trimmed = (override ?? message).trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError(null)
    try {
      const res: InsightsAskResponse = await api.askInsights({
        message: trimmed,
        scope: currentScope,
        conversationId,
      })
      setMessages(prev => [...prev, res.user_message, res.assistant_message])
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
      setConversationId(res.conversation.id)
      setMessages(res.messages)
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

  const hasDraftMessage = message.trim().length > 0

  const handleNewChat = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setMessage('')
    setError(null)
    focusComposer()
  }, [focusComposer])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  const historyLabel = useCallback(
    (c: InsightsConversation): string =>
      c.title || `${SCOPE_LABELS[c.scope_type] ?? c.scope_type} · ${c.updated_at.slice(0, 10)}`,
    [],
  )

  const recentConversations = useMemo(() => conversations.slice(0, 12), [conversations])
  const effectiveVoiceMode = normalizeInsightsVoiceMode(insightsVoiceMode)
  const {
    voiceState,
    start,
    stop,
    endSession,
    lastTranscript,
    lastAnswer,
    lastError,
    outputLevel,
  } = useInsightsVoice({
    scope: currentScope,
    conversationId,
    mode: effectiveVoiceMode,
    onCompleted: handleVoiceCompleted,
  })
  const voiceOrbVisible = effectiveVoiceMode !== 'off' && voiceState !== 'idle'
  const voiceOrbTranscript = lastAnswer || lastTranscript
  const voiceErrorText = lastError ?? defaultVoiceErrorText
  const [voiceAnnouncement, setVoiceAnnouncement] = useState('')
  const previousVoiceStateRef = useRef(voiceState)
  const previousVoiceErrorRef = useRef<string | null>(lastError ?? null)

  useEffect(() => {
    if (effectiveVoiceMode === 'off') {
      previousVoiceStateRef.current = voiceState
      previousVoiceErrorRef.current = lastError ?? null
      setVoiceAnnouncement('')
      return
    }

    const previousVoiceState = previousVoiceStateRef.current
    const previousVoiceError = previousVoiceErrorRef.current

    if (previousVoiceState === voiceState && previousVoiceError === (lastError ?? null)) {
      return
    }

    let nextAnnouncement = ''
    switch (voiceState) {
      case 'connecting':
        nextAnnouncement = 'Connecting to voice.'
        break
      case 'listening':
        nextAnnouncement = 'Listening.'
        break
      case 'thinking':
        nextAnnouncement = 'Thinking.'
        break
      case 'speaking':
        nextAnnouncement = 'Speaking.'
        break
      case 'interrupted':
        nextAnnouncement = 'Voice stopped.'
        break
      case 'error':
        nextAnnouncement = `Voice error: ${voiceErrorText}`
        break
      case 'idle':
        nextAnnouncement = previousVoiceState !== 'idle' ? 'Voice stopped.' : ''
        break
    }

    previousVoiceStateRef.current = voiceState
    previousVoiceErrorRef.current = lastError ?? null
    setVoiceAnnouncement(nextAnnouncement)
  }, [effectiveVoiceMode, lastError, voiceErrorText, voiceState])

  const handleVoiceAction = useCallback(() => {
    if (effectiveVoiceMode === 'off') {
      focusComposer()
      return
    }

    if (voiceState === 'idle' || voiceState === 'error' || voiceState === 'interrupted') {
      void start()
      return
    }

    if (voiceState === 'connecting' || voiceState === 'thinking') {
      return
    }

    if (voiceState === 'speaking') {
      void stop()
      return
    }

    void endSession()
  }, [effectiveVoiceMode, endSession, focusComposer, start, stop, voiceState])

  const handleEndVoiceSession = useCallback(() => {
    if (effectiveVoiceMode === 'off' || voiceState === 'idle') {
      return
    }

    void endSession()
  }, [effectiveVoiceMode, endSession, voiceState])

  const voiceActionLabel = useMemo(() => {
    if (effectiveVoiceMode === 'off') {
      return 'Talk to Wulo'
    }

    switch (voiceState) {
      case 'error':
        return 'Retry voice'
      case 'connecting':
        return 'Connecting...'
      case 'listening':
        return 'End voice session'
      case 'thinking':
        return 'Waiting for reply'
      case 'speaking':
        return 'Interrupt reply'
      default:
        return 'Start voice'
    }
  }, [effectiveVoiceMode, voiceState])

  const orbInterruptLabel = useMemo(() => {
    switch (voiceState) {
      case 'speaking':
        return 'Interrupt reply'
      default:
        return 'Stop voice'
    }
  }, [voiceState])

  const voiceActionPressed =
    effectiveVoiceMode === 'off' ? undefined : voiceState === 'listening' ? true : voiceState === 'idle' ? false : undefined
  const voiceActionDisabled =
    loading || (effectiveVoiceMode !== 'off' && (voiceState === 'connecting' || voiceState === 'thinking'))
  const voiceActionClassName = mergeClasses(
    styles.toolButton,
    styles.voiceButton,
    effectiveVoiceMode !== 'off' && voiceState !== 'idle' ? styles.voiceButtonActive : undefined,
    voiceState === 'listening' ? styles.voiceButtonListening : undefined,
    voiceState === 'error' ? styles.voiceButtonError : undefined,
    voiceState === 'connecting' ? styles.voiceButtonBusy : undefined,
  )

  if (mode === 'collapsed') {
    return (
      <aside
        className={mergeClasses(styles.root, styles.rootCollapsed, className)}
        data-testid="insights-rail"
        data-mode="collapsed"
        aria-label="Insights agent rail (collapsed)"
      >
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => changeMode('normal')}
          aria-label="Open insights chat"
          title="Open insights chat"
          data-testid="insights-rail-expand"
        >
          ←
        </button>
        <button
          type="button"
          className={styles.collapsedLauncher}
          onClick={() => changeMode('normal')}
          aria-label="Open insights chat"
          title="Open insights chat"
          data-testid="insights-rail-launcher"
        >
          <span className={styles.collapsedEyebrow}>AI</span>
          <span className={styles.collapsedLabel}>Open chat</span>
          <span className={styles.collapsedHint}>Ask your data</span>
        </button>
        <span className={styles.collapsedBadge} aria-hidden>
          AI
        </span>
      </aside>
    )
  }

  return (
    <aside
      className={mergeClasses(styles.root, mode === 'full' && styles.rootFull, className)}
      data-testid="insights-rail"
      data-mode={mode}
      aria-label={mode === 'full' ? 'Insights agent rail (full screen)' : 'Insights agent rail'}
    >
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={handleNewChat}
            aria-label="New chat"
            title="New chat"
            data-testid="insights-rail-new-chat"
          >
            {/* compose icon */}
            <span aria-hidden>✎</span>
          </button>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <button
                type="button"
                className={styles.menuTrigger}
                aria-label="My conversations"
                data-testid="insights-rail-conversations-menu"
              >
                My conversations
                <span aria-hidden style={{ fontSize: '0.8em' }}>▾</span>
              </button>
            </MenuTrigger>
            <MenuPopover>
              <div className={styles.menuLabel}>Recent</div>
              {recentConversations.length === 0 ? (
                <div className={styles.menuEmpty}>No conversations yet.</div>
              ) : (
                <MenuList>
                  {recentConversations.map(c => (
                    <MenuItem
                      key={c.id}
                      onClick={() => void handleOpenConversation(c.id)}
                      data-testid="insights-rail-history-item"
                    >
                      {historyLabel(c)}
                    </MenuItem>
                  ))}
                </MenuList>
              )}
            </MenuPopover>
          </Menu>
        </div>
        <div className={styles.topBarRight}>
          {mode === 'full' ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => changeMode('normal')}
              aria-label="Exit full screen"
              title="Exit full screen"
              data-testid="insights-rail-restore"
            >
              ⤡
            </button>
          ) : (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => changeMode('full')}
              aria-label="Expand to full screen"
              title="Expand to full screen"
              data-testid="insights-rail-fullscreen"
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => changeMode('collapsed')}
            aria-label="Collapse to side tab"
            title="Collapse to side tab"
            data-testid="insights-rail-collapse"
          >
            {'>'}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <fieldset
          className={styles.scopeRow}
          aria-label="Insights scope"
          style={{ border: 'none', padding: 0, margin: 0 }}
        >
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

        {error ? (
          <div className={styles.error} role="alert" data-testid="insights-rail-error">
            {error}
          </div>
        ) : null}

        {messages.length === 0 && !loading ? (
          <div className={styles.suggestionGroup} data-testid="insights-rail-suggestions">
            {suggestionPrompts.map(prompt => (
              <button
                key={prompt}
                type="button"
                className={styles.suggestionChip}
                onClick={() => void handleSend(prompt)}
                disabled={loading}
                data-testid="insights-rail-suggestion"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {messages.length > 0 ? (
          <div className={styles.transcript} data-testid="insights-rail-transcript">
            {messages.map(messageEntry => {
              const isAssistant = messageEntry.role === 'assistant'
              return (
                <div
                  key={messageEntry.id}
                  className={mergeClasses(
                    styles.messageRow,
                    isAssistant ? styles.messageRowAssistant : styles.messageRowUser,
                  )}
                  data-testid={isAssistant ? 'insights-rail-answer' : 'insights-rail-user-message'}
                >
                  <div className={styles.messageMetaRow}>
                    <span
                      className={mergeClasses(
                        styles.messageRoleBadge,
                        isAssistant ? styles.messageRoleBadgeAssistant : styles.messageRoleBadgeUser,
                      )}
                    >
                      {isAssistant ? 'Wulo' : 'You'}
                    </span>
                    <span className={styles.messageTimestamp}>
                      {formatMessageTimestamp(messageEntry.created_at)}
                    </span>
                  </div>
                  <div
                    className={mergeClasses(
                      styles.messageBubble,
                      isAssistant ? styles.messageBubbleAssistant : styles.messageBubbleUser,
                    )}
                  >
                    {renderMessageContent(messageEntry.content_text || '(no answer)', styles)}
                    {isAssistant && messageEntry.visualizations && messageEntry.visualizations.length > 0 ? (
                      <div className={styles.artifactGroup}>
                        <Text className={styles.artifactLabel}>Charts</Text>
                        <div className={styles.visualizationStack} data-testid="insights-rail-visualizations">
                          {messageEntry.visualizations.map((v, idx) => (
                            <VisualizationBlock key={`${messageEntry.id}-viz-${idx}`} spec={v} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {isAssistant && messageEntry.citations && messageEntry.citations.length > 0 ? (
                      <div className={styles.artifactGroup}>
                        <Text className={styles.artifactLabel}>Sources</Text>
                        <div
                          className={styles.citations}
                          data-testid="insights-rail-citations"
                          aria-label="Citations"
                        >
                          {messageEntry.citations.map((c, idx) => (
                            <span key={`${messageEntry.id}-cit-${idx}`} className={styles.citationChip}>
                              {citationLabel(c)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {voiceOrbVisible ? (
        <div className={styles.voiceOrbWrap}>
          <InsightsOrb
            state={voiceState}
            outputLevel={outputLevel}
            transcript={voiceOrbTranscript}
            onInterrupt={voiceState === 'speaking' ? () => {
              void stop()
            } : undefined}
            interruptLabel={orbInterruptLabel}
            onEndSession={handleEndVoiceSession}
          />
        </div>
      ) : null}

      <div className={styles.composerWrap}>
        <div className={styles.composerCard}>
          <textarea
            ref={textareaRef}
            className={styles.composerInput}
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about progress, patterns, or evidence…"
            rows={1}
            disabled={loading}
            data-testid="insights-rail-input"
          />
          <div className={styles.composerFooter}>
            {effectiveVoiceMode !== 'off' ? (
              <output className={styles.srOnly} aria-live="polite">
                {voiceAnnouncement}
              </output>
            ) : null}
            <div className={styles.composerTools}>
              <button
                type="button"
                className={styles.toolButton}
                aria-label="Attach"
                title="Attach (coming soon)"
                disabled
              >
                +
              </button>
              {effectiveVoiceMode !== 'off' && voiceState === 'error' ? (
                <span className={styles.voiceInlineError}>{voiceErrorText}</span>
              ) : null}
            </div>
            {hasDraftMessage ? (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => void handleSend()}
                disabled={loading || !hasDraftMessage}
                data-testid="insights-rail-send"
                aria-label="Send message"
                title="Send message"
              >
                {loading ? <Spinner size="tiny" /> : <span aria-hidden>↑</span>}
              </button>
            ) : (
              <button
                type="button"
                className={voiceActionClassName}
                onClick={handleVoiceAction}
                disabled={voiceActionDisabled}
                data-testid="insights-rail-voice-action"
                aria-label={voiceActionLabel}
                title={voiceActionLabel}
                {...(effectiveVoiceMode !== 'off' ? { 'data-voice-state': voiceState } : {})}
                {...(voiceActionPressed === undefined ? {} : { 'aria-pressed': voiceActionPressed })}
              >
                <MicrophoneIcon className={styles.voiceIcon} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

export default InsightsRail
