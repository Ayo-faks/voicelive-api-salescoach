/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
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
  InsightsCitation,
  InsightsConversation,
  InsightsMessage,
  InsightsScope,
  InsightsScopeType,
  InsightsVoiceMode,
  ChatAskResponse,
} from '../types'
import { api, StreamUnsupportedError } from '../services/api'
import { InsightsOrb } from './InsightsOrb'
import { VisualizationBlock } from './VisualizationBlock'
import VoiceAgentDynamicSurface from '../learning/components/VoiceAgentDynamicSurface'
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

function normalizeInsightsVoiceMode(
  mode: InsightsVoiceMode
): InsightsVoiceMode {
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
    boxShadow:
      '0 1px 2px rgba(15, 42, 58, 0.04), 0 8px 24px rgba(15, 42, 58, 0.06)',
    minWidth: '320px',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    maxHeight: 'calc(100vh - 48px)',
    fontFeatureSettings: '"ss01", "cv11"',
    position: 'relative',
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
    boxShadow:
      '0 1px 2px rgba(15, 15, 15, 0.04), 0 8px 24px rgba(15, 15, 15, 0.06)',
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px 12px',
    background:
      'linear-gradient(180deg, rgba(250,252,252,0.96), rgba(240,247,247,0.92))',
    borderBottom: '1px solid rgba(15,42,58,0.06)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(15,42,58,0.04)',
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
    transition:
      'box-shadow 120ms ease, background 120ms ease, border-color 120ms ease',
    ':hover': {
      background:
        'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,250,250,0.85))',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.08)',
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
    transition:
      'box-shadow 120ms ease, background 120ms ease, border-color 120ms ease',
    ':hover': {
      background:
        'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,250,250,0.85))',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.08)',
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
  historyBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    background: 'rgba(0, 0, 0, 0.45)',
    border: 'none',
    padding: 0,
    margin: 0,
    appearance: 'none',
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: '180ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    cursor: 'pointer',
  },
  historyDrawer: {
    position: 'fixed',
    bottom: '96px',
    right: 'calc(min(420px, calc(100vw - 48px)) + 24px + 8px)',
    height: 'min(640px, calc(100vh - 140px))',
    width: '300px',
    zIndex: 61,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0d0d0f',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow:
      '0 24px 64px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
    transformOrigin: 'right center',
    animationName: {
      from: { transform: 'translateX(12px) scale(0.96)', opacity: 0 },
      to: { transform: 'translateX(0) scale(1)', opacity: 1 },
    },
    animationDuration: '240ms',
    animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    animationFillMode: 'both',
    '@media (max-width: 1000px)': {
      right: '12px',
      left: '12px',
      bottom: '88px',
      width: 'auto',
      height: 'min(70vh, calc(100vh - 120px))',
    },
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  historyTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: '0.01em',
  },
  historyList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '6px 0',
  },
  historyItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '10px 14px',
    fontSize: tokens.fontSizeBase300,
    color: 'rgba(255,255,255,0.86)',
    lineHeight: 1.35,
    fontFamily: 'inherit',
    transition: 'background-color 120ms ease',
    ':hover': { backgroundColor: 'rgba(255,255,255,0.06)' },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: '-2px',
    },
  },
  historyItemActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    fontWeight: tokens.fontWeightSemibold,
  },
  historyEmpty: {
    fontSize: tokens.fontSizeBase200,
    color: 'rgba(255,255,255,0.55)',
    padding: '12px 14px',
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
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    cursor: 'pointer',
    padding: '12px 6px',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.02em',
    color: tokens.colorNeutralForeground1,
  },
  collapsedEyebrow: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground3,
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
    background: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
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
    background: tokens.colorNeutralForeground1,
    borderTopColor: tokens.colorNeutralForeground1,
    borderRightColor: tokens.colorNeutralForeground1,
    borderBottomColor: tokens.colorNeutralForeground1,
    borderLeftColor: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
    boxShadow: '0 1px 2px rgba(15, 15, 15, 0.18)',
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
    backgroundColor: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
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
    boxShadow: '0 1px 2px rgba(15, 15, 15, 0.04)',
    letterSpacing: '-0.01em',
    animationName: {
      from: { opacity: 0, transform: 'translateY(6px) scale(0.985)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '260ms',
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    animationFillMode: 'both',
  },
  thinkingBubble: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: '0 1px 2px rgba(15, 15, 15, 0.04)',
    animationName: {
      from: { opacity: 0, transform: 'translateY(6px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    animationDuration: '220ms',
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    animationFillMode: 'both',
  },
  thinkingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: tokens.colorNeutralForeground2,
    display: 'inline-block',
    animationName: {
      '0%, 60%, 100%': { transform: 'translateY(0)', opacity: 0.45 },
      '30%': { transform: 'translateY(-4px)', opacity: 1 },
    },
    animationDuration: '1100ms',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  thinkingDot2: {
    animationDelay: '160ms',
  },
  thinkingDot3: {
    animationDelay: '320ms',
  },
  messageBubbleUser: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
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
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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
    transitionProperty:
      'background-color, border-color, color, box-shadow, transform',
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
      boxShadow: '0 0 0 3px rgba(15, 15, 15, 0.10)',
      borderTopColor: tokens.colorNeutralStroke1,
      borderRightColor: tokens.colorNeutralStroke1,
      borderBottomColor: tokens.colorNeutralStroke1,
      borderLeftColor: tokens.colorNeutralStroke1,
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
    background: tokens.colorNeutralBackground3,
    borderTopColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    borderBottomColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
    color: tokens.colorNeutralForeground1,
    boxShadow: '0 0 0 1px rgba(15, 15, 15, 0.14)',
  },
  voiceButtonListening: {
    animationName: {
      '0%': { boxShadow: '0 0 0 0 rgba(15, 15, 15, 0.24)' },
      '70%': { boxShadow: '0 0 0 8px rgba(15, 15, 15, 0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(15, 15, 15, 0)' },
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
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  voiceToggleActive: {
    background: tokens.colorNeutralForeground1,
    color: tokens.colorNeutralBackground1,
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
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
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
  }
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

function renderMessageContent(
  content: string,
  styles: ReturnType<typeof useStyles>
) {
  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className={styles.markdownParagraph}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul className={styles.markdownList}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className={styles.markdownList}>{children}</ol>
          ),
          li: ({ children }) => (
            <li className={styles.markdownListItem}>{children}</li>
          ),
          code: ({ children }) => (
            <code className={styles.markdownCode}>{children}</code>
          ),
          h1: ({ children }) => (
            <p className={styles.markdownParagraph}>
              <strong>{children}</strong>
            </p>
          ),
          h2: ({ children }) => (
            <p className={styles.markdownParagraph}>
              <strong>{children}</strong>
            </p>
          ),
          h3: ({ children }) => (
            <p className={styles.markdownParagraph}>
              <strong>{children}</strong>
            </p>
          ),
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
  const defaultVoiceErrorText =
    'Microphone blocked - allow access in your browser to use voice.'
  const [mode, setMode] = useState<InsightsRailMode>(
    () => requestedMode ?? initialMode ?? readStoredMode()
  )

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
    [onModeChange]
  )
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingAssistant, setAwaitingAssistant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<InsightsMessage[]>([])
  // Id of the assistant bubble currently receiving stream frames. While this
  // is non-null the message renders with a blinking caret. Cleared on `done`,
  // `error`, abort, or scope switch.
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  )
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InsightsConversation[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusTokenRef = useRef<number | undefined>(focusToken)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const restoredScopeKeyRef = useRef<string | null>(null)
  // Aborts the in-flight chat stream when the user starts another turn,
  // navigates away, or switches scope. Cleared by `handleSend` on completion.
  const abortRef = useRef<AbortController | null>(null)

  const suggestionPrompts = useMemo<string[]>(() => {
    switch (currentScope.type) {
      case 'session':
        return ['Summarise this session', 'What should we work on next?']
      case 'report':
        return ['Summarise this report', 'Highlight the key changes']
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

    const inner = (node as unknown as HTMLElement | null)?.querySelector?.(
      'textarea'
    )
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
    node.style.overflowY =
      measuredHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
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

  const scopeKey = useMemo(() => {
    const parts: string[] = [currentScope.type]
    if (currentScope.child_id) parts.push(`child:${currentScope.child_id}`)
    if (currentScope.session_id) parts.push(`session:${currentScope.session_id}`)
    if (currentScope.report_id) parts.push(`report:${currentScope.report_id}`)
    return parts.join('|')
  }, [
    currentScope.type,
    currentScope.child_id,
    currentScope.session_id,
    currentScope.report_id,
  ])

  const conversationStorageKey = useMemo(
    () => `wulo.insightsRail.conversationId.${scopeKey}`,
    [scopeKey]
  )

  // Restore the per-scope conversation from sessionStorage when the scope
  // changes. Each scope keeps its own thread so switching back to the same
  // scope continues where the user left off within this browser session.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (restoredScopeKeyRef.current === scopeKey) return
    restoredScopeKeyRef.current = scopeKey
    let storedId: string | null = null
    try {
      storedId = window.sessionStorage.getItem(conversationStorageKey)
    } catch {
      storedId = null
    }
    if (!storedId) {
      setConversationId(null)
      setMessages([])
      return
    }
    let cancelled = false
    setConversationId(storedId)
    const idToLoad = storedId
    ;(async () => {
      try {
        const res = await api.getInsightsConversation(idToLoad)
        if (cancelled) return
        setMessages(res.messages || [])
        setConversationId(res.conversation.id)
        scrollTranscriptToBottom()
      } catch {
        if (cancelled) return
        // Stored id no longer valid — clear it and start fresh.
        try {
          window.sessionStorage.removeItem(conversationStorageKey)
        } catch {
          /* ignore */
        }
        setConversationId(null)
        setMessages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scopeKey, conversationStorageKey])

  // Persist the active conversation id so a reload (or remount of the rail)
  // re-attaches to the same thread for this scope.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (conversationId) {
        window.sessionStorage.setItem(conversationStorageKey, conversationId)
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, [conversationId, conversationStorageKey])

  // Auto-scroll the transcript so the latest reply (or the thinking
  // indicator) is always in view after each turn.
  const scrollTranscriptToBottom = useCallback(() => {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const node = transcriptScrollRef.current
      if (!node) return
      if (typeof node.scrollTo === 'function') {
        node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
      } else {
        node.scrollTop = node.scrollHeight
      }
    })
  }, [])

  const handleVoiceCompleted = useCallback(
    (payload: UseInsightsVoiceTurnCompleted) => {
      const resolvedConversationId =
        payload.conversationId || conversationId || createClientMessageId()
      const nextMessages: InsightsMessage[] = []
      if (payload.transcript.trim()) {
        nextMessages.push(
          createVoiceMessage('user', resolvedConversationId, payload.transcript)
        )
      }
      nextMessages.push(
        createVoiceMessage(
          'assistant',
          resolvedConversationId,
          payload.answerText,
          {
            citations: payload.citations,
            visualizations: payload.visualizations,
          }
        )
      )
      setConversationId(resolvedConversationId)
      setMessages(prev => [...prev, ...nextMessages])
      scrollTranscriptToBottom()
      void loadHistory()
    },
    [conversationId, loadHistory, scrollTranscriptToBottom]
  )

  const handleSend = useCallback(
    async (override?: string) => {
      const trimmed = (override ?? message).trim()
      if (!trimmed || loading) return
      // Cancel any in-flight stream from a previous turn (defensive — `loading`
      // should already prevent overlap, but reasoning about React batching is
      // hard and an orphaned reader would leak the connection).
      if (abortRef.current) {
        abortRef.current.abort()
      }
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      setError(null)
      const optimisticConversationId =
        conversationId || createClientMessageId()
      const optimisticUser: InsightsMessage = {
        id: createClientMessageId(),
        conversation_id: optimisticConversationId,
        role: 'user',
        content_text: trimmed,
        citations: [],
        visualizations: [],
        tool_trace: [],
        latency_ms: null,
        tool_calls_count: null,
        prompt_version: 'chat-v1',
        error_text: null,
        created_at: new Date().toISOString(),
      }
      // Pre-create the assistant bubble so token frames have something to
      // append to as soon as they arrive.
      const assistantId = createClientMessageId()
      const assistantStub: InsightsMessage = {
        id: assistantId,
        conversation_id: optimisticConversationId,
        role: 'assistant',
        content_text: '',
        citations: [],
        visualizations: [],
        tool_trace: [],
        latency_ms: null,
        tool_calls_count: null,
        prompt_version: 'chat-v1',
        error_text: null,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, optimisticUser, assistantStub])
      setMessage('')
      setAwaitingAssistant(true)
      setStreamingMessageId(assistantId)
      scrollTranscriptToBottom()

      const applyFinalEnvelope = (
        res: ChatAskResponse,
        finalConvId: string
      ) => {
        setMessages(prev =>
          prev.map(m => {
            if (m.id === optimisticUser.id) {
              return { ...m, conversation_id: finalConvId }
            }
            if (m.id === assistantId) {
              return {
                ...m,
                conversation_id: finalConvId,
                content_text: res.answer_text || '',
                citations: res.citations || [],
                visualizations: res.visualizations || [],
                latency_ms: res.latency_ms ?? null,
                tool_calls_count: res.tool_calls_count ?? null,
                error_text: res.error_text ?? null,
                ui_specs: res.ui_specs,
                action_suggestions: res.action_suggestions,
              }
            }
            return m
          })
        )
        setConversationId(finalConvId)
      }

      try {
        let nextConversationId = optimisticConversationId
        let answerText = ''
        let citations: InsightsCitation[] = []
        let visualizations: ChatAskResponse['visualizations'] = []
        let uiSpecs: ChatAskResponse['ui_specs'] | undefined
        let actionSuggestions: ChatAskResponse['action_suggestions'] | undefined
        let latencyMs: number | null = null
        let toolCallsCount: number | null = null
        let errorText: string | null = null
        let streamError: { code: string; message: string } | null = null

        try {
          for await (const ev of api.chatStream({
            message: trimmed,
            scope: currentScope,
            conversationId,
            signal: controller.signal,
          })) {
            switch (ev.type) {
              case 'meta':
                if (ev.data.conversation_id) {
                  nextConversationId = ev.data.conversation_id
                }
                break
              case 'token':
                answerText += ev.data.delta || ''
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId ? { ...m, content_text: answerText } : m
                  )
                )
                scrollTranscriptToBottom()
                break
              case 'artifacts':
                citations = ev.data.citations || []
                visualizations = ev.data.visualizations || []
                uiSpecs = ev.data.ui_specs
                actionSuggestions = ev.data.action_suggestions
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? {
                          ...m,
                          citations,
                          visualizations,
                          ui_specs: uiSpecs,
                          action_suggestions: actionSuggestions,
                        }
                      : m
                  )
                )
                break
              case 'done':
                nextConversationId =
                  ev.data.conversation_id || nextConversationId
                latencyMs = ev.data.latency_ms ?? null
                toolCallsCount = ev.data.tool_calls_count ?? null
                errorText = ev.data.error_text ?? null
                break
              case 'error':
                streamError = {
                  code: ev.data.code,
                  message: ev.data.message,
                }
                break
            }
          }
        } catch (streamErr) {
          if (streamErr instanceof StreamUnsupportedError) {
            // Server has streaming disabled or removed — fall back once to
            // the legacy one-shot endpoint. The UI shows the thinking caret
            // until the full envelope arrives.
            const fallback = await api.askChat({
              message: trimmed,
              scope: currentScope,
              conversationId,
            })
            const finalConvId =
              fallback.conversation_id || optimisticConversationId
            applyFinalEnvelope(fallback, finalConvId)
            scrollTranscriptToBottom()
            void loadHistory()
            return
          }
          throw streamErr
        }

        if (streamError) {
          throw new Error(streamError.message || 'Chat stream failed')
        }

        // Settle final envelope (use streamed values; the message bubble is
        // already in sync from per-frame updates above).
        setMessages(prev =>
          prev.map(m => {
            if (m.id === optimisticUser.id) {
              return { ...m, conversation_id: nextConversationId }
            }
            if (m.id === assistantId) {
              return {
                ...m,
                conversation_id: nextConversationId,
                content_text: answerText,
                citations,
                visualizations,
                ui_specs: uiSpecs,
                action_suggestions: actionSuggestions,
                latency_ms: latencyMs,
                tool_calls_count: toolCallsCount,
                error_text: errorText,
              }
            }
            return m
          })
        )
        setConversationId(nextConversationId)
        scrollTranscriptToBottom()
        void loadHistory()
      } catch (err) {
        if (controller.signal.aborted) {
          // Caller aborted (e.g. scope switch). Drop the optimistic + stub
          // turn silently — no error UI.
          setMessages(prev =>
            prev.filter(m => m.id !== optimisticUser.id && m.id !== assistantId)
          )
        } else {
          setError(err instanceof Error ? err.message : 'Request failed')
          setMessages(prev =>
            prev.filter(m => m.id !== optimisticUser.id && m.id !== assistantId)
          )
          setMessage(trimmed)
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setStreamingMessageId(null)
        setAwaitingAssistant(false)
        setLoading(false)
      }
    },
    [message, loading, currentScope, conversationId, loadHistory, scrollTranscriptToBottom]
  )

  const handleOpenConversation = useCallback(async (id: string) => {
    // Cancel any in-flight stream — the user's switching to a historical
    // conversation and the streaming bubble is no longer relevant.
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setLoading(true)
    setError(null)
    setStreamingMessageId(null)
    try {
      const res = await api.getInsightsConversation(id)
      setConversationId(res.conversation.id)
      setMessages(res.messages)
      scrollTranscriptToBottom()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load conversation'
      )
    } finally {
      setLoading(false)
    }
  }, [scrollTranscriptToBottom])

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
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setConversationId(null)
    setMessages([])
    setMessage('')
    setError(null)
    setStreamingMessageId(null)
    focusComposer()
  }, [focusComposer])

  // Abort any in-flight stream on unmount so we don't leak the reader.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  const historyLabel = useCallback(
    (c: InsightsConversation): string =>
      c.title ||
      `${SCOPE_LABELS[c.scope_type] ?? c.scope_type} · ${c.updated_at.slice(0, 10)}`,
    []
  )

  const recentConversations = useMemo(
    () => conversations.slice(0, 12),
    [conversations]
  )
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

    if (
      previousVoiceState === voiceState &&
      previousVoiceError === (lastError ?? null)
    ) {
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

    if (
      voiceState === 'idle' ||
      voiceState === 'error' ||
      voiceState === 'interrupted'
    ) {
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
    effectiveVoiceMode === 'off'
      ? undefined
      : voiceState === 'listening'
        ? true
        : voiceState === 'idle'
          ? false
          : undefined
  const voiceActionDisabled =
    loading ||
    (effectiveVoiceMode !== 'off' &&
      (voiceState === 'connecting' || voiceState === 'thinking'))
  const voiceActionClassName = mergeClasses(
    styles.toolButton,
    styles.voiceButton,
    effectiveVoiceMode !== 'off' && voiceState !== 'idle'
      ? styles.voiceButtonActive
      : undefined,
    voiceState === 'listening' ? styles.voiceButtonListening : undefined,
    voiceState === 'error' ? styles.voiceButtonError : undefined,
    voiceState === 'connecting' ? styles.voiceButtonBusy : undefined
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
      className={mergeClasses(
        styles.root,
        mode === 'full' && styles.rootFull,
        className
      )}
      data-testid="insights-rail"
      data-mode={mode}
      aria-label={
        mode === 'full'
          ? 'Insights agent rail (full screen)'
          : 'Insights agent rail'
      }
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
          <button
            type="button"
            className={styles.menuTrigger}
            aria-label="My conversations"
            aria-haspopup="dialog"
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen(v => {
                const next = !v
                if (next) void loadHistory()
                return next
              })
            }}
            data-testid="insights-rail-conversations-menu"
          >
            My conversations
            <span aria-hidden style={{ fontSize: '0.8em' }}>
              ▾
            </span>
          </button>
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

      <div className={styles.body} ref={transcriptScrollRef}>
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
                  disabled && styles.chipDisabled
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
          <div
            className={styles.error}
            role="alert"
            data-testid="insights-rail-error"
          >
            {error}
          </div>
        ) : null}

        {messages.length === 0 && !loading ? (
          <div
            className={styles.suggestionGroup}
            data-testid="insights-rail-suggestions"
          >
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
          <div
            className={styles.transcript}
            data-testid="insights-rail-transcript"
          >
            {messages.map(messageEntry => {
              const isAssistant = messageEntry.role === 'assistant'
              const isStreamingThis =
                isAssistant && messageEntry.id === streamingMessageId
              return (
                <div
                  key={messageEntry.id}
                  className={mergeClasses(
                    styles.messageRow,
                    isAssistant
                      ? styles.messageRowAssistant
                      : styles.messageRowUser
                  )}
                  data-testid={
                    isAssistant
                      ? 'insights-rail-answer'
                      : 'insights-rail-user-message'
                  }
                >
                  <div className={styles.messageMetaRow}>
                    <span
                      className={mergeClasses(
                        styles.messageRoleBadge,
                        isAssistant
                          ? styles.messageRoleBadgeAssistant
                          : styles.messageRoleBadgeUser
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
                      isAssistant
                        ? styles.messageBubbleAssistant
                        : styles.messageBubbleUser
                    )}
                  >
                    {(() => {
                      const fullText = messageEntry.content_text || ''
                      if (isStreamingThis && !fullText) {
                        return (
                          <div
                            className={styles.thinkingBubble}
                            aria-label="Assistant is thinking"
                            data-testid="insights-rail-streaming-thinking"
                          >
                            <span className={styles.thinkingDot} aria-hidden />
                            <span
                              className={mergeClasses(
                                styles.thinkingDot,
                                styles.thinkingDot2
                              )}
                              aria-hidden
                            />
                            <span
                              className={mergeClasses(
                                styles.thinkingDot,
                                styles.thinkingDot3
                              )}
                              aria-hidden
                            />
                          </div>
                        )
                      }
                      return renderMessageContent(
                        fullText || '(no answer)',
                        styles
                      )
                    })()}
                    {isAssistant &&
                    messageEntry.visualizations &&
                    messageEntry.visualizations.length > 0 ? (
                      <div className={styles.artifactGroup}>
                        <Text className={styles.artifactLabel}>Charts</Text>
                        <div
                          className={styles.visualizationStack}
                          data-testid="insights-rail-visualizations"
                        >
                          {messageEntry.visualizations.map((v, idx) => (
                            <VisualizationBlock
                              key={`${messageEntry.id}-viz-${idx}`}
                              spec={v}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {isAssistant &&
                    ((messageEntry.ui_specs &&
                      messageEntry.ui_specs.length > 0) ||
                      (messageEntry.action_suggestions &&
                        messageEntry.action_suggestions.length > 0)) ? (
                      <div
                        className={styles.artifactGroup}
                        data-testid="insights-rail-dynamic-surface"
                      >
                        <VoiceAgentDynamicSurface
                          uiSpecs={messageEntry.ui_specs ?? []}
                          actionSuggestions={
                            messageEntry.action_suggestions ?? []
                          }
                          actionsEnabled={false}
                        />
                      </div>
                    ) : null}
                    {isAssistant &&
                    messageEntry.citations &&
                    messageEntry.citations.length > 0 ? (
                      <div className={styles.artifactGroup}>
                        <Text className={styles.artifactLabel}>Sources</Text>
                        <div
                          className={styles.citations}
                          data-testid="insights-rail-citations"
                          aria-label="Citations"
                        >
                          {messageEntry.citations.map((c, idx) => (
                            <span
                              key={`${messageEntry.id}-cit-${idx}`}
                              className={styles.citationChip}
                            >
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
            {awaitingAssistant && !streamingMessageId ? (
              <div
                className={mergeClasses(
                  styles.messageRow,
                  styles.messageRowAssistant
                )}
                data-testid="insights-rail-thinking"
                aria-live="polite"
              >
                <div className={styles.messageMetaRow}>
                  <span
                    className={mergeClasses(
                      styles.messageRoleBadge,
                      styles.messageRoleBadgeAssistant
                    )}
                  >
                    Wulo
                  </span>
                </div>
                <div
                  className={styles.thinkingBubble}
                  aria-label="Assistant is thinking"
                >
                  <span className={styles.thinkingDot} aria-hidden />
                  <span
                    className={mergeClasses(
                      styles.thinkingDot,
                      styles.thinkingDot2
                    )}
                    aria-hidden
                  />
                  <span
                    className={mergeClasses(
                      styles.thinkingDot,
                      styles.thinkingDot3
                    )}
                    aria-hidden
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {voiceOrbVisible ? (
        <div className={styles.voiceOrbWrap}>
          <InsightsOrb
            state={voiceState}
            outputLevel={outputLevel}
            transcript={voiceOrbTranscript}
            onInterrupt={
              voiceState === 'speaking'
                ? () => {
                    void stop()
                  }
                : undefined
            }
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
                <span className={styles.voiceInlineError}>
                  {voiceErrorText}
                </span>
              ) : null}
            </div>
            {hasDraftMessage || loading ? (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => void handleSend()}
                disabled={loading || !hasDraftMessage}
                data-testid="insights-rail-send"
                aria-label={loading ? 'Sending message' : 'Send message'}
                title={loading ? 'Sending…' : 'Send message'}
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
                {...(effectiveVoiceMode !== 'off'
                  ? { 'data-voice-state': voiceState }
                  : {})}
                {...(voiceActionPressed === undefined
                  ? {}
                  : { 'aria-pressed': voiceActionPressed })}
              >
                <MicrophoneIcon className={styles.voiceIcon} />
              </button>
            )}
          </div>
        </div>
      </div>
      {historyOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            className={styles.historyBackdrop}
            aria-label="Close conversation history"
            onClick={() => setHistoryOpen(false)}
          />
          <section
            className={styles.historyDrawer}
            aria-label="Recent conversations"
            data-testid="insights-rail-history-drawer"
          >
            <div className={styles.historyHeader}>
              <span className={styles.historyTitle}>Recent</span>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setHistoryOpen(false)}
                aria-label="Close conversation history"
              >
                ✕
              </button>
            </div>
            {recentConversations.length === 0 ? (
              <div className={styles.historyEmpty}>No conversations yet.</div>
            ) : (
              <div className={styles.historyList}>
                {recentConversations.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className={mergeClasses(
                      styles.historyItem,
                      c.id === conversationId && styles.historyItemActive
                    )}
                    onClick={() => {
                      setHistoryOpen(false)
                      void handleOpenConversation(c.id)
                    }}
                    data-testid="insights-rail-history-item"
                  >
                    {historyLabel(c)}
                  </button>
                ))}
              </div>
            )}
          </section>
        </>,
        document.body
      )}
    </aside>
  )
}

export default InsightsRail
