import { useCallback, useEffect, useState } from 'react'
import { FluentProvider, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ChatBubbleLeftRightIcon, MicrophoneIcon, MinusIcon } from '@heroicons/react/24/solid'
import { InsightsRail } from '../components/InsightsRail'
import { api, type AuthSession } from '../services/api'
import type { AppConfig, ChildProfile, InsightsScope } from '../types'
import LearnerEmptyState from './components/LearnerEmptyState'
import LearnerSelector from './components/LearnerSelector'
import VoiceAgentFullscreen from './components/VoiceAgentFullscreen'
import PracticeFullscreen from './components/PracticeFullscreen'
import WelcomeRolePicker from './components/WelcomeRolePicker'
import { storeSelectedLearnerId, useSelectedLearner } from './hooks/useSelectedLearner'
import { useLearnerSetup } from './hooks/useLearnerSetup'
import PathwaysExplorer from './routes/PathwaysExplorer'
import SkillLibrary from './routes/SkillLibrary'
import StudentLearningHome from './routes/StudentLearningHome'
import StudentMasteryProfile from './routes/StudentMasteryProfile'
import TeacherMasteryDashboard from './routes/TeacherMasteryDashboard'
import TrustSafetyConsole from './routes/TrustSafetyConsole'
import { pathfinderFluentTheme } from './theme/pathfinderFluentTheme'
import { pathfinderTokens as t } from './theme/pathfinder-tokens'
import AskPathfinder from './AskPathfinder'
import { LearnerContext, defaultLearnerContext } from './contexts/LearnerContext'

export const COOKIE_CONSENT_STORAGE_KEY = 'pathfinder.cookie-consent.v1'

function getStoredCookieConsent(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeCookieConsent(choice: 'accepted' | 'managed'): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice)
  } catch {
    // Keep dismissal usable even when storage is blocked.
  }
}

type NavItem = {
  to: string
  label: string
  hint: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  allowedRoles: LearningRole[]
}

type AccountAction = {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  testId: string
}

export type LearningRole = AuthSession['role'] | 'learner' | 'kid' | 'student' | 'unassigned'

const navItems: NavItem[] = [
  { to: '/home', label: 'Learner', hint: 'Today', icon: AcademicCapIcon, allowedRoles: ['parent', 'learner', 'kid', 'student'] },
  { to: '/teacher', label: 'Teacher', hint: 'Class', icon: ChartBarIcon, allowedRoles: ['therapist', 'admin'] },
  { to: '/library', label: 'Library', hint: 'Skills', icon: BookOpenIcon, allowedRoles: ['admin'] },
  { to: '/profile', label: 'Profile', hint: 'Insights', icon: UserCircleIcon, allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'] },
  { to: '/pathways', label: 'Pathways', hint: 'Explore', icon: MagnifyingGlassIcon, allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'] },
  { to: '/safety', label: 'Trust & Safety', hint: 'Console', icon: ShieldCheckIcon, allowedRoles: ['admin'] },
]

const PATHFINDER_CHAT_SCOPE: InsightsScope = { type: 'caseload' }

const accountActions: AccountAction[] = [
  { href: '/profile', label: 'Learning profile', icon: UserCircleIcon, testId: 'account-action-profile' },
  { href: '/settings', label: 'Settings', icon: Cog6ToothIcon, testId: 'account-action-settings' },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheckIcon, testId: 'account-action-privacy' },
  { href: '/terms', label: 'Terms', icon: DocumentTextIcon, testId: 'account-action-terms' },
  { href: '/ai-transparency', label: 'AI notice', icon: InformationCircleIcon, testId: 'account-action-ai-notice' },
]

function formatRoleLabel(role: LearningRole | 'loading'): string {
  if (role === 'loading') return 'Loading account'
  if (role === 'pending_therapist') return 'Pending therapist'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function normalizeLearningRole(role: string | null | undefined): LearningRole {
  if (role === 'therapist' || role === 'parent' || role === 'admin' || role === 'pending_therapist') {
    return role
  }
  if (role === 'kid' || role === 'student' || role === 'learner') {
    return role
  }
  if (role === 'unassigned') {
    return 'unassigned'
  }
  return 'learner'
}

export function navItemsForRole(role: LearningRole): NavItem[] {
  return navItems.filter(item => item.allowedRoles.includes(role))
}

export function defaultPathForRole(role: LearningRole): string {
  if (role === 'therapist' || role === 'admin') return '/teacher'
  if (role === 'parent') return '/profile'
  return '/home'
}

const useStyles = makeStyles({
  provider: {
    minHeight: '100vh',
    backgroundColor: t.brand.page,
  },
  page: {
    minHeight: '100vh',
    backgroundColor: t.brand.page,
    color: t.brand.text,
    fontFamily: t.font.text,
    display: 'grid',
    gridTemplateColumns: '260px 1fr',
    gridTemplateRows: '1fr',
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' },
  },
  sidebar: {
    position: 'sticky',
    top: 0,
    alignSelf: 'start',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '20px 14px',
    backgroundColor: t.brand.surface,
    borderRight: t.surface.hairline,
    boxSizing: 'border-box',
    '@media (max-width: 1000px)': { display: 'none' },
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 8px 18px',
  },
  brandMark: {
    width: '32px',
    height: '32px',
    borderRadius: '9px',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: '0.85rem',
    letterSpacing: '-0.02em',
    fontFamily: t.font.display,
  },
  brandText: { display: 'grid', gap: '2px' },
  brandTitle: {
    fontFamily: t.font.display,
    fontSize: '0.98rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1,
    color: t.brand.text,
  },
  brandSubtitle: {
    fontSize: '0.72rem',
    color: t.brand.textTertiary,
    letterSpacing: '0.01em',
  },
  navGroupLabel: {
    fontSize: '0.66rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: t.brand.textTertiary,
    padding: '12px 10px 6px',
    fontWeight: 600,
  },
  navLink: {
    display: 'grid',
    gridTemplateColumns: '20px 1fr auto',
    alignItems: 'center',
    gap: '10px',
    minHeight: '38px',
    padding: '8px 10px',
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    boxSizing: 'border-box',
    backgroundColor: 'transparent',
    textDecoration: 'none',
    color: t.brand.textSecondary,
    fontSize: '0.88rem',
    fontWeight: 600,
    transition: 'background-color .12s, border-color .12s, color .12s, box-shadow .12s',
    ':hover': {
      backgroundColor: t.brand.surfaceMuted,
      borderTopColor: t.brand.line,
      borderRightColor: t.brand.line,
      borderBottomColor: t.brand.line,
      borderLeftColor: t.brand.line,
      color: t.brand.text,
    },
  },
  navIcon: { width: '18px', height: '18px' },
  navHint: {
    fontSize: '0.7rem',
    fontWeight: 500,
    color: 'inherit',
    opacity: 0.7,
  },
  sidebarFooter: {
    marginTop: 'auto',
    padding: '10px',
    borderTop: t.surface.hairline,
    display: 'grid',
    gap: '4px',
    color: t.brand.textTertiary,
    fontSize: '0.7rem',
    lineHeight: 1.35,
  },
  userCard: {
    display: 'grid',
    gap: '10px',
    padding: '10px',
    borderRadius: t.radius.sm,
    border: t.surface.hairline,
    backgroundColor: t.brand.surfaceMuted,
  },
  userHeader: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  userAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '999px',
    display: 'grid',
    placeItems: 'center',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    fontFamily: t.font.display,
    fontWeight: 700,
    fontSize: '0.85rem',
  },
  userInfo: {
    display: 'grid',
    gap: '1px',
    minWidth: 0,
  },
  userName: {
    fontFamily: t.font.display,
    fontSize: '0.82rem',
    fontWeight: 600,
    color: t.brand.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userEmail: {
    fontSize: '0.7rem',
    color: t.brand.textTertiary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userRole: {
    fontSize: '0.66rem',
    color: t.brand.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 700,
  },
  accountActions: {
    display: 'grid',
    gap: '4px',
    paddingTop: '8px',
    borderTop: t.surface.hairline,
  },
  accountAction: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '32px',
    padding: '6px 8px',
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: t.brand.textSecondary,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 700,
    textAlign: 'left',
    textDecoration: 'none',
    transition: 'background-color .12s, border-color .12s, color .12s',
    ':hover': {
      backgroundColor: t.brand.surface,
      borderTopColor: t.brand.line,
      borderRightColor: t.brand.line,
      borderBottomColor: t.brand.line,
      borderLeftColor: t.brand.line,
      color: t.brand.text,
    },
  },
  accountActionIcon: { width: '16px', height: '16px', flexShrink: 0 },
  mobileAccountActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  mobileUserPill: {
    display: 'grid',
    placeItems: 'center',
    width: '34px',
    height: '34px',
    borderRadius: '999px',
    border: t.surface.hairline,
    backgroundColor: t.brand.surfaceMuted,
    textDecoration: 'none',
    color: t.brand.text,
  },
  mobileAccountButton: {
    appearance: 'none',
    width: '34px',
    height: '34px',
    borderRadius: t.radius.sm,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.textSecondary,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    textDecoration: 'none',
    ':hover': {
      color: t.brand.text,
      backgroundColor: t.brand.surfaceMuted,
    },
  },
  mobileAccountIcon: { width: '18px', height: '18px' },
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
  main: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  mobileTopBar: {
    display: 'none',
    '@media (max-width: 1000px)': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      backgroundColor: t.brand.surface,
      borderBottom: t.surface.hairline,
      position: 'sticky',
      top: 0,
      zIndex: 5,
    },
  },
  content: {
    flex: 1,
    padding: '28px 36px 120px',
    maxWidth: '1440px',
    width: '100%',
    margin: '0 auto',
    boxSizing: 'border-box',
    '@media (max-width: 1100px)': { padding: '24px 24px 120px' },
    '@media (max-width: 720px)': { padding: '16px 14px 110px' },
  },
  bottomNav: {
    display: 'none',
    '@media (max-width: 1000px)': {
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: '2px',
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: t.brand.surface,
      borderTop: t.surface.hairline,
      padding: '8px 6px 12px',
      zIndex: 10,
    },
  },
  bottomNavLink: {
    display: 'grid',
    justifyItems: 'center',
    gap: '3px',
    minHeight: '52px',
    padding: '6px 2px',
    textDecoration: 'none',
    color: t.brand.textTertiary,
    fontSize: '0.65rem',
    fontWeight: 600,
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    boxSizing: 'border-box',
    transition: 'background-color .12s, border-color .12s, color .12s',
    ':hover': {
      backgroundColor: t.brand.surfaceMuted,
      borderTopColor: t.brand.line,
      borderRightColor: t.brand.line,
      borderBottomColor: t.brand.line,
      borderLeftColor: t.brand.line,
      color: t.brand.text,
    },
  },
  bottomNavIcon: { width: '22px', height: '22px' },
  voiceLauncher: {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: 40,
    width: '60px',
    height: '60px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: 'linear-gradient(160deg, #3a3a3c 0%, #0a0a0a 100%)',
    boxShadow:
      '0 12px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.18)',
    transformOrigin: 'center',
    transition:
      'transform .18s cubic-bezier(0.2, 0.8, 0.2, 1), filter .15s ease, box-shadow .2s ease',
    animationName: {
      from: { opacity: 0, transform: 'translateY(18px) scale(0.5)' },
      '60%': { opacity: 1, transform: 'translateY(-2px) scale(1.06)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '420ms',
    animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    animationFillMode: 'both',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    ':active': { transform: 'scale(0.92)' },
    '@media (max-width: 1000px)': {
      bottom: '88px',
      right: '16px',
      width: '54px',
      height: '54px',
    },
  },
  voiceLauncherGlyph: { width: '24px', height: '24px' },
  chatLauncher: {
    position: 'fixed',
    right: '24px',
    bottom: '96px',
    zIndex: 40,
    width: '60px',
    height: '60px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    color: '#ffffff',
    background: 'linear-gradient(160deg, #3a3a3c 0%, #0a0a0a 100%)',
    boxShadow:
      '0 12px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.18)',
    transformOrigin: 'center',
    transition:
      'transform .18s cubic-bezier(0.2, 0.8, 0.2, 1), filter .15s ease, box-shadow .2s ease',
    animationName: {
      from: { opacity: 0, transform: 'translateY(18px) scale(0.5)' },
      '60%': { opacity: 1, transform: 'translateY(-2px) scale(1.06)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '420ms',
    animationDelay: '60ms',
    animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    animationFillMode: 'both',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    ':active': { transform: 'scale(0.92)' },
    '@media (max-width: 1000px)': {
      bottom: '152px',
      right: '16px',
      width: '54px',
      height: '54px',
    },
  },
  chatLauncherGlyph: { width: '24px', height: '24px' },
  chatPanel: {
    position: 'fixed',
    right: '24px',
    bottom: '96px',
    zIndex: 45,
    width: 'min(420px, calc(100vw - 48px))',
    height: 'min(640px, calc(100vh - 140px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: '18px',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow:
      '0 24px 64px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
    background: '#0d0d0f',
    transformOrigin: 'bottom right',
    willChange: 'transform, opacity',
    transition:
      'right 280ms cubic-bezier(0.22, 1, 0.36, 1), left 280ms cubic-bezier(0.22, 1, 0.36, 1), top 280ms cubic-bezier(0.22, 1, 0.36, 1), bottom 280ms cubic-bezier(0.22, 1, 0.36, 1), width 280ms cubic-bezier(0.22, 1, 0.36, 1), height 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    animationName: {
      from: {
        opacity: 0,
        transform: 'translateY(24px) scale(0.82)',
        filter: 'blur(6px)',
      },
      '60%': {
        opacity: 1,
        transform: 'translateY(-2px) scale(1.01)',
        filter: 'blur(0)',
      },
      to: { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
    },
    animationDuration: '320ms',
    animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    animationFillMode: 'both',
    '@media (max-width: 1000px)': {
      right: '12px',
      bottom: '88px',
      width: 'calc(100vw - 24px)',
    },
  },
  chatPanelClosing: {
    animationName: {
      from: { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
      to: {
        opacity: 0,
        transform: 'translateY(16px) scale(0.86)',
        filter: 'blur(4px)',
      },
    },
    animationDuration: '220ms',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 1, 1)',
    animationFillMode: 'forwards',
    pointerEvents: 'none',
  },
  chatPanelExpanded: {
    right: '24px',
    left: '24px',
    top: '24px',
    bottom: '24px',
    width: 'auto',
    height: 'auto',
    transition:
      'right 280ms cubic-bezier(0.22, 1, 0.36, 1), left 280ms cubic-bezier(0.22, 1, 0.36, 1), top 280ms cubic-bezier(0.22, 1, 0.36, 1), bottom 280ms cubic-bezier(0.22, 1, 0.36, 1), width 280ms cubic-bezier(0.22, 1, 0.36, 1), height 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    '@media (max-width: 1000px)': {
      right: '12px',
      left: '12px',
      top: '12px',
      bottom: '12px',
    },
  },
  chatPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'linear-gradient(180deg, #1a1a1c 0%, #0d0d0f 100%)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    color: '#ffffff',
  },
  chatPanelTitle: {
    fontFamily: t.font.text,
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  chatPanelMinimize: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: '#ffffff',
    cursor: 'pointer',
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'rgba(255,255,255,0.08)' },
  },
  chatPanelMinimizeGlyph: { width: '16px', height: '16px' },
  chatPanelBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  cookieBanner: {
    position: 'fixed',
    left: 'calc(260px + 24px)',
    bottom: '24px',
    zIndex: 30,
    pointerEvents: 'auto',
    width: 'min(560px, calc(100vw - 380px))',
    maxHeight: '32vh',
    overflowY: 'auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '14px',
    alignItems: 'center',
    padding: '16px 18px',
    borderRadius: '8px',
    backgroundColor: t.brand.surface,
    borderTop: t.surface.hairline,
    borderRight: t.surface.hairline,
    borderBottom: t.surface.hairline,
    borderLeft: t.surface.hairline,
    boxShadow: '0 18px 48px rgba(30, 41, 59, 0.22)',
    boxSizing: 'border-box',
    '@media (max-width: 1200px)': {
      left: '24px',
      width: 'min(560px, calc(100vw - 132px))',
    },
    '@media (max-width: 1000px)': {
      left: '12px',
      right: '84px',
      bottom: '88px',
      width: 'auto',
      maxHeight: '28vh',
      gridTemplateColumns: '1fr',
      alignItems: 'stretch',
      gap: '10px',
      padding: '14px',
    },
    '@media (max-width: 560px)': {
      right: '12px',
      bottom: '154px',
    },
  },
  cookieBannerCopy: {
    display: 'grid',
    gap: '5px',
    minWidth: 0,
  },
  cookieBannerTitle: {
    fontFamily: t.font.display,
    fontSize: '0.95rem',
    fontWeight: 700,
    color: t.brand.text,
  },
  cookieBannerText: {
    fontSize: '0.82rem',
    lineHeight: 1.45,
    color: t.brand.textSecondary,
  },
  cookieBannerActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    flexWrap: 'wrap',
    '@media (max-width: 1000px)': {
      justifyContent: 'flex-start',
    },
  },
  cookieButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '34px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 800,
  },
  cookieButtonPrimary: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '34px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 800,
  },
})

export function CookieConsentBanner() {
  const styles = useStyles()
  const [visible, setVisible] = useState(() => getStoredCookieConsent() === null)

  const dismiss = (choice: 'accepted' | 'managed') => {
    storeCookieConsent(choice)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <section
      className={styles.cookieBanner}
      data-testid="cookie-consent-banner"
      aria-label="Cookie consent"
    >
      <div className={styles.cookieBannerCopy}>
        <div className={styles.cookieBannerTitle}>We use cookies</div>
        <Text className={styles.cookieBannerText}>
          Wulo uses essential cookies for the app to work. Analytics stay off unless
          you choose to manage preferences later.
        </Text>
      </div>
      <div className={styles.cookieBannerActions}>
        <button type="button" className={styles.cookieButton} onClick={() => dismiss('managed')}>
          Manage
        </button>
        <button
          type="button"
          className={styles.cookieButtonPrimary}
          data-testid="cookie-consent-accept"
          onClick={() => dismiss('accepted')}
        >
          Accept
        </button>
      </div>
    </section>
  )
}

export default function PathfinderLearnApp() {
  const styles = useStyles()
  const location = useLocation()
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const [learningRole, setLearningRole] = useState<LearningRole | 'loading'>('loading')
  const [learnerChildren, setLearnerChildren] = useState<ChildProfile[] | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatClosing, setChatClosing] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(false)
  const closeChatPanel = useCallback(() => {
    setChatClosing(true)
    window.setTimeout(() => {
      setChatOpen(false)
      setChatClosing(false)
      setChatExpanded(false)
    }, 220)
  }, [])
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const { selectedLearnerId, setSelectedLearnerId } = useSelectedLearner(learnerChildren ?? [])
  const effectiveRole = learningRole === 'loading' ? 'learner' : learningRole
  const visibleNavItems = learningRole === 'loading' ? [] : navItemsForRole(effectiveRole)
  const voiceLauncherVisible =
    !!appConfig?.voice_agent_fullscreen_enabled &&
    (appConfig?.insights_voice_mode ?? 'off') !== 'off'
  const chatLauncherVisible = !!appConfig?.insights_rail_enabled
  const practiceFullscreenEnabled =
    !!appConfig?.learner_voice_fullscreen_enabled &&
    ['learner', 'kid', 'student'].includes(effectiveRole)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const activeLearnerIdForPractice =
    selectedLearnerId ?? learnerChildren?.[0]?.id ?? null
  const [learnerSetup] = useLearnerSetup()

  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then(cfg => { if (!cancelled) setAppConfig(cfg) })
      .catch(() => { if (!cancelled) setAppConfig(null) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.getAuthSession()
      .then(async session => {
        if (!session.authenticated) {
          if (!cancelled) {
            setAuthStatus('unauthenticated')
            setAuthSession(null)
            setLearnerChildren(null)
          }
          return
        }
        const nextRole = normalizeLearningRole(session.role)
        if (!cancelled) {
          setAuthStatus('authenticated')
          setLearningRole(nextRole)
          setAuthSession(session)
        }
        if (!['parent', 'learner', 'kid', 'student'].includes(nextRole)) return
        try {
          const children = await api.getChildren(session.current_workspace_id)
          if (!cancelled) setLearnerChildren(children)
        } catch {
          if (!cancelled) setLearnerChildren([])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus('unauthenticated')
          setAuthSession(null)
          setLearnerChildren(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-fetch children when role changes to a learner-facing role (e.g. after
  // role selection on the welcome screen) and the list is currently unknown.
  useEffect(() => {
    if (learnerChildren !== null) return
    if (!authSession?.authenticated) return
    if (!['parent', 'learner', 'kid', 'student'].includes(effectiveRole)) return
    let cancelled = false
    api.getChildren(authSession.current_workspace_id)
      .then(children => { if (!cancelled) setLearnerChildren(children) })
      .catch(() => { if (!cancelled) setLearnerChildren([]) })
    return () => { cancelled = true }
  }, [authSession?.authenticated, authSession?.current_workspace_id, effectiveRole, learnerChildren])

  // When a self-service learner lands with no children yet, auto-create their
  // self-learner profile so they can start practising immediately.
  useEffect(() => {
    if (effectiveRole !== 'learner') return
    if (!authSession?.authenticated) return
    if (learnerChildren === null) return
    if (learnerChildren.length > 0) return
    let cancelled = false
    api.createSelfLearner()
      .then(child => {
        if (cancelled) return
        storeSelectedLearnerId(child.id)
        setLearnerChildren([child])
      })
      .catch(() => { /* LearnerEmptyState remains as fallback */ })
    return () => { cancelled = true }
  }, [effectiveRole, authSession?.authenticated, learnerChildren])

  const handleOnboardingChosen = useCallback((session: AuthSession) => {
    setAuthStatus('authenticated')
    setAuthSession(session)
    setLearningRole(normalizeLearningRole(session.role))
    // Force a children refetch on next render path
    setLearnerChildren(null)
  }, [])

  const routeForRole = (allowedRoles: LearningRole[], element: JSX.Element | null) => {
    if (learningRole === 'loading') return null
    return allowedRoles.includes(effectiveRole)
      ? element
      : <Navigate to={defaultPathForRole(effectiveRole)} replace />
  }

  const learnerHomeElement = () => {
    if (learnerChildren === null) return null
    if (learnerChildren.length === 0) return <LearnerEmptyState />
    const activeLearnerId = selectedLearnerId ?? learnerChildren[0]?.id ?? null
    return (
      <>
        <LearnerSelector
          learners={learnerChildren}
          selectedLearnerId={activeLearnerId}
          onChange={setSelectedLearnerId}
        />
        <StudentLearningHome
          key={activeLearnerId ?? 'no-learner'}
          studentId={activeLearnerId}
          learnerTutorEnabled={['learner', 'kid', 'student'].includes(effectiveRole)}
          pushConsentDeferred={effectiveRole === 'kid'}
        />
      </>
    )
  }

  const renderNavLinks = (extraClass?: string) =>
    visibleNavItems.map(item => {
      const Icon = item.icon
      return (
        <NavLink
          key={item.to}
          to={item.to}
          className={extraClass ?? styles.navLink}
          style={({ isActive }) =>
            isActive
              ? {
                  backgroundColor: t.brand.ink,
                  borderColor: t.brand.ink,
                  color: t.brand.onInk,
                  boxShadow: extraClass ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.18)',
                }
              : undefined
          }
        >
          <Icon
            className={extraClass ? styles.bottomNavIcon : styles.navIcon}
            aria-hidden="true"
          />
          {item.label}
          {!extraClass && (
            <span className={styles.navHint}>{item.hint}</span>
          )}
        </NavLink>
      )
    })

  const renderAccountCard = () => {
    if (!authSession?.authenticated) return null
    const accountInitial = (authSession.name || authSession.email || '?').charAt(0).toUpperCase()
    return (
      <div className={styles.userCard} data-testid="sidebar-user-card">
        <div className={styles.userHeader}>
          <span className={styles.userAvatar} aria-hidden="true">
            {accountInitial}
          </span>
          <div className={styles.userInfo}>
            <Text className={styles.userName}>{authSession.name || 'User'}</Text>
            {authSession.email ? (
              <Text className={styles.userEmail}>{authSession.email}</Text>
            ) : null}
            <Text className={styles.userRole}>{formatRoleLabel(effectiveRole)}</Text>
          </div>
        </div>
        <nav className={styles.accountActions} aria-label="Account actions">
          {accountActions.map(action => {
            const Icon = action.icon
            return (
              <a
                key={action.href}
                href={action.href}
                className={styles.accountAction}
                data-testid={action.testId}
              >
                <Icon className={styles.accountActionIcon} aria-hidden="true" />
                <span>{action.label}</span>
              </a>
            )
          })}
          <a
            href="/logout"
            className={styles.accountAction}
            data-testid="account-action-sign-out"
          >
            <ArrowRightStartOnRectangleIcon className={styles.accountActionIcon} aria-hidden="true" />
            <span>Sign out</span>
          </a>
        </nav>
      </div>
    )
  }

  if (effectiveRole === 'unassigned' && authSession?.authenticated) {
    return (
      <FluentProvider theme={pathfinderFluentTheme} className={styles.provider}>
        <WelcomeRolePicker onChosen={handleOnboardingChosen} />
      </FluentProvider>
    )
  }

  if (authStatus === 'unauthenticated') {
    return <Navigate to={{ pathname: '/login', search: location.search }} replace />
  }

  return (
    <FluentProvider theme={pathfinderFluentTheme} className={styles.provider}>
      <div className={styles.page} data-testid="pathfinder-learn-app">
        <aside className={styles.sidebar} aria-label="Pathfinder primary">
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              Pf
            </span>
            <div className={styles.brandText}>
              <Text className={styles.brandTitle}>Pathfinder</Text>
              <Text className={styles.brandSubtitle}>Wulo Learning · JSS1-SS3</Text>
            </div>
          </div>

          <div className={styles.navGroupLabel}>Workspaces</div>
          <nav aria-label="Pathfinder views" style={{ display: 'grid', gap: '2px' }}>
            {renderNavLinks()}
            {practiceFullscreenEnabled && activeLearnerIdForPractice ? (
              <button
                type="button"
                className={styles.navLink}
                onClick={() => setPracticeOpen(true)}
                aria-label="Open Pathfinder practice"
                data-testid="sidebar-practice-link"
                style={{ fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              >
                <BookOpenIcon className={styles.navIcon} aria-hidden="true" />
                Practice
                <span className={styles.navHint}>Cards</span>
              </button>
            ) : null}
          </nav>

          <div className={styles.sidebarFooter}>
            <span>English · Yoruba voice ready</span>
            <span>Counsellor sign-off active</span>
          </div>

          {renderAccountCard()}
        </aside>

        <main className={styles.main}>
          <div className={styles.mobileTopBar}>
            <div className={styles.brand} style={{ padding: 0 }}>
              <span className={styles.brandMark} aria-hidden="true">
                Pf
              </span>
              <div className={styles.brandText}>
                <Text className={styles.brandTitle}>Pathfinder</Text>
                <Text className={styles.brandSubtitle}>Wulo Learning · JSS1-SS3</Text>
              </div>
            </div>
            {authSession?.authenticated ? (
              <div className={styles.mobileAccountActions}>
                <a
                  href="/settings"
                  className={styles.mobileAccountButton}
                  aria-label="Open settings"
                  title="Settings"
                  data-testid="mobile-account-settings"
                >
                  <Cog6ToothIcon className={styles.mobileAccountIcon} aria-hidden="true" />
                  <span className={styles.srOnly}>Settings</span>
                </a>
                <a
                  href="/logout"
                  className={styles.mobileAccountButton}
                  aria-label="Sign out"
                  title="Sign out"
                  data-testid="mobile-account-sign-out"
                >
                  <ArrowRightStartOnRectangleIcon className={styles.mobileAccountIcon} aria-hidden="true" />
                  <span className={styles.srOnly}>Sign out</span>
                </a>
              </div>
            ) : null}
          </div>

          <div className={styles.content}>
            <Routes>
              <Route index element={learningRole === 'loading' ? null : <Navigate to={defaultPathForRole(effectiveRole)} replace />} />
              <Route path="/logout" element={<Navigate to="/.auth/logout" replace />} />
              <Route path="/home" element={routeForRole(['parent', 'learner', 'kid', 'student'], learnerHomeElement())} />
              <Route path="/teacher" element={routeForRole(['therapist', 'admin'], <TeacherMasteryDashboard />)} />
              <Route path="/library" element={routeForRole(['admin'], <SkillLibrary />)} />
              <Route path="/profile" element={routeForRole(['parent', 'learner', 'kid', 'student', 'admin'], <StudentMasteryProfile />)} />
              <Route path="/pathways" element={routeForRole(['parent', 'learner', 'kid', 'student', 'admin'], <PathwaysExplorer />)} />
              <Route path="/safety" element={routeForRole(['admin'], <TrustSafetyConsole />)} />
              <Route path="*" element={learningRole === 'loading' ? null : <Navigate to={defaultPathForRole(effectiveRole)} replace />} />
            </Routes>
          </div>

          <nav
            className={styles.bottomNav}
            aria-label="Pathfinder bottom nav"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleNavItems.length)}, 1fr)` }}
          >
            {renderNavLinks(styles.bottomNavLink)}
          </nav>
        </main>
        {['learner', 'kid', 'student'].includes(effectiveRole) && (
          <LearnerContext.Provider value={defaultLearnerContext}>
            <AskPathfinder />
          </LearnerContext.Provider>
        )}
        {practiceFullscreenEnabled && activeLearnerIdForPractice && !practiceOpen && (
          <button
            type="button"
            className={styles.voiceLauncher}
            onClick={() => setPracticeOpen(true)}
            aria-label="Open Pathfinder practice"
            data-testid="practice-launcher"
          >
            <BookOpenIcon className={styles.voiceLauncherGlyph} aria-hidden="true" />
          </button>
        )}
        {practiceFullscreenEnabled && activeLearnerIdForPractice && practiceOpen && (
          <PracticeFullscreen
            open={practiceOpen}
            onClose={() => setPracticeOpen(false)}
            childId={activeLearnerIdForPractice}
            exam={learnerSetup.exam}
            classYear={learnerSetup.year}
            subject={learnerSetup.subject}
          />
        )}
        {voiceLauncherVisible && !voiceOpen && (
          <button
            type="button"
            className={styles.voiceLauncher}
            onClick={() => setVoiceOpen(true)}
            aria-label="Open Pathfinder voice assistant"
            data-testid="voice-agent-launcher"
          >
            <MicrophoneIcon className={styles.voiceLauncherGlyph} aria-hidden="true" />
          </button>
        )}
        {chatLauncherVisible && !chatOpen && (
          <button
            type="button"
            className={styles.chatLauncher}
            onClick={() => setChatOpen(true)}
            aria-label="Open Pathfinder text assistant"
            data-testid="pathfinder-chat-launcher"
          >
            <ChatBubbleLeftRightIcon className={styles.chatLauncherGlyph} aria-hidden="true" />
          </button>
        )}
        {chatLauncherVisible && chatOpen && (
          <aside
            className={mergeClasses(
              styles.chatPanel,
              chatExpanded && styles.chatPanelExpanded,
              chatClosing && styles.chatPanelClosing
            )}
            aria-label="Pathfinder text assistant"
            data-testid="pathfinder-chat-panel"
          >
            <header className={styles.chatPanelHeader}>
              <span className={styles.chatPanelTitle}>Pathfinder Assistant</span>
              <button
                type="button"
                className={styles.chatPanelMinimize}
                onClick={closeChatPanel}
                aria-label="Minimize assistant"
                data-testid="pathfinder-chat-minimize"
              >
                <MinusIcon className={styles.chatPanelMinimizeGlyph} aria-hidden="true" />
              </button>
            </header>
            <div className={styles.chatPanelBody}>
              <InsightsRail
                currentScope={PATHFINDER_CHAT_SCOPE}
                mode={chatExpanded ? 'full' : 'normal'}
                onModeChange={next => {
                  if (next === 'collapsed') closeChatPanel()
                  else if (next === 'full') setChatExpanded(true)
                  else if (next === 'normal') setChatExpanded(false)
                }}
                insightsVoiceMode={appConfig?.insights_voice_mode ?? 'off'}
              />
            </div>
          </aside>
        )}
        {voiceLauncherVisible && (
          <VoiceAgentFullscreen
            open={voiceOpen}
            onClose={() => setVoiceOpen(false)}
            actionsEnabled={!!appConfig?.voice_agent_actions_enabled}
          />
        )}
        <CookieConsentBanner />
      </div>
    </FluentProvider>
  )
}
