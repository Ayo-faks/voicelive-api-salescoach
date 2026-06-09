import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FluentProvider,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import {
  AcademicCapIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  UserCircleIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  ChatBubbleLeftRightIcon,
  MicrophoneIcon,
  MinusIcon,
} from '@heroicons/react/24/solid'
import { InsightsRail } from '../components/InsightsRail'
import { api, type AuthSession } from '../services/api'
import type { AppConfig, ChildProfile, InsightsScope } from '../types'
import LearnerSelector from './components/LearnerSelector'
import ParentFamilyHome from './components/ParentFamilyHome'
import VoiceAgentFullscreen from './components/VoiceAgentFullscreen'
import PracticeFullscreen from './components/PracticeFullscreen'
import WelcomeRolePicker from './components/WelcomeRolePicker'
import {
  storeSelectedLearnerId,
  useSelectedLearner,
} from './hooks/useSelectedLearner'
import { useLearnerSetup } from './hooks/useLearnerSetup'
import { useLearnerProfile } from './hooks/useLearnerProfile'
import LearnerOnboardingWizard from './onboarding/LearnerOnboardingWizard'
import GoalIntakeScreen from './GoalIntakeScreen'
import VoiceOnboardingFlow from './VoiceOnboardingFlow'
import PathwaysExplorer from './routes/PathwaysExplorer'
import ExamPrepLibrary from './routes/ExamPrepLibrary'
import SkillLibrary from './routes/SkillLibrary'
import StudentLearningHome from './routes/StudentLearningHome'
import StudentMasteryProfile from './routes/StudentMasteryProfile'
import TeacherMasteryDashboard from './routes/TeacherMasteryDashboard'
import TrustSafetyConsole from './routes/TrustSafetyConsole'
import ObservabilityDashboard from './routes/ObservabilityDashboard'
import {
  PathfinderAccountHub,
  PathfinderAiNotice,
  PathfinderPrivacy,
  PathfinderSettings,
  PathfinderTerms,
} from './routes/AccountPages'
import {
  pathfinderFluentTheme,
  pathfinderFluentThemeDark,
} from './theme/pathfinderFluentTheme'
import { pathfinderTokens as t } from './theme/pathfinder-tokens'
import { usePathfinderThemeStyles } from './theme/pathfinderThemeStyles'
import AskPathfinder from './AskPathfinder'
import {
  LearnerContext,
  defaultLearnerContext,
} from './contexts/LearnerContext'
import {
  PathfinderThemeProvider,
  usePathfinderTheme,
} from './contexts/PathfinderThemeContext'
import { OnboardingRuntime } from '../components/onboarding/OnboardingRuntime'
import { HelpMenu } from '../components/onboarding/HelpMenu'
import { requestReplayTour } from '../onboarding/bus'
import { featureFlags } from '../utils/featureFlags'

export const COOKIE_CONSENT_STORAGE_KEY = 'pathfinder.cookie-consent.v1'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'wulo-academy.sidebar-collapsed.v1'

function getStoredCookieConsent(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)
  } catch {
    return null
  }
}

function getStoredSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? 'true' : 'false'
    )
  } catch {
    // Sidebar remains usable for the current session when storage is blocked.
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
  testId: string
}

type AccountAction = {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  testId: string
}

export type LearningRole =
  | AuthSession['role']
  | 'learner'
  | 'kid'
  | 'student'
  | 'unassigned'

const navItems: NavItem[] = [
  {
    to: '/home',
    label: 'Home',
    hint: 'Today',
    icon: AcademicCapIcon,
    allowedRoles: ['learner', 'kid', 'student'],
    testId: 'pf-nav-home',
  },
  {
    to: '/family',
    label: 'Family',
    hint: 'Children',
    icon: UsersIcon,
    allowedRoles: ['parent'],
    testId: 'pf-nav-family',
  },
  {
    to: '/teacher',
    label: 'Teacher',
    hint: 'Class',
    icon: ChartBarIcon,
    allowedRoles: ['therapist', 'admin'],
    testId: 'pf-nav-teacher',
  },
  {
    to: '/exam-prep',
    label: 'Exam prep',
    hint: 'WAEC · NECO',
    icon: BookOpenIcon,
    allowedRoles: ['parent', 'learner', 'kid', 'student'],
    testId: 'pf-nav-exam-prep',
  },
  {
    to: '/library',
    label: 'Library',
    hint: 'Skills',
    icon: BookOpenIcon,
    allowedRoles: ['admin'],
    testId: 'pf-nav-library',
  },
  {
    to: '/profile',
    label: 'Profile',
    hint: 'Insights',
    icon: UserCircleIcon,
    allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'],
    testId: 'pf-nav-profile',
  },
  {
    to: '/pathways',
    label: 'Pathways',
    hint: 'Explore',
    icon: MagnifyingGlassIcon,
    allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'],
    testId: 'pf-nav-pathways',
  },
  {
    to: '/safety',
    label: 'Trust & Safety',
    hint: 'Console',
    icon: ShieldCheckIcon,
    allowedRoles: ['admin'],
    testId: 'pf-nav-safety',
  },
  {
    to: '/observability',
    label: 'Observability',
    hint: 'Signals',
    icon: ChartBarSquareIcon,
    allowedRoles: ['admin'],
    testId: 'pf-nav-observability',
  },
]

const PATHFINDER_CHAT_SCOPE: InsightsScope = { type: 'caseload' }

// Retained for documentation; the routed account hub now owns these actions
// (see frontend/src/learning/routes/AccountHub.tsx).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _accountActions: AccountAction[] = [
  {
    href: '/account/settings',
    label: 'Settings',
    icon: Cog6ToothIcon,
    testId: 'account-action-settings',
  },
  {
    href: '/account/privacy',
    label: 'Privacy',
    icon: ShieldCheckIcon,
    testId: 'account-action-privacy',
  },
  {
    href: '/account/terms',
    label: 'Terms',
    icon: DocumentTextIcon,
    testId: 'account-action-terms',
  },
  {
    href: '/account/ai-notice',
    label: 'AI notice',
    icon: InformationCircleIcon,
    testId: 'account-action-ai-notice',
  },
]

function formatRoleLabel(role: LearningRole | 'loading'): string {
  if (role === 'loading') return 'Loading account'
  if (role === 'pending_therapist') return 'Pending therapist'
  if (role === 'learner' || role === 'kid' || role === 'student') return 'Student'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function normalizeLearningRole(
  role: string | null | undefined
): LearningRole {
  if (
    role === 'therapist' ||
    role === 'parent' ||
    role === 'admin' ||
    role === 'pending_therapist'
  ) {
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
  if (role === 'parent') return '/family'
  return '/home'
}

const useStyles = makeStyles({
  // NOTE: FluentProvider applies this className to portal mount nodes too
  // (applyStylesToPortals defaults to true). Keep it free of layout/background
  // styles, otherwise popups (e.g. Dropdown) inherit a full-viewport opaque
  // panel and cover the screen. The page/role-picker children own the
  // min-height + background.
  provider: {},
  page: {
    minHeight: '100vh',
    backgroundColor: 'var(--pf-page)',
    color: 'var(--pf-text)',
    fontFamily: t.font.text,
    display: 'grid',
    gridTemplateColumns: '260px minmax(0, 1fr)',
    gridTemplateRows: '1fr',
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' },
  },
  pageSidebarCollapsed: {
    gridTemplateColumns: '76px minmax(0, 1fr)',
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' },
  },
  routeBar: {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    height: '48px',
    display: 'none',
    alignItems: 'center',
    gap: '14px',
    padding: '0 18px',
    backgroundColor: 'var(--pf-surface)',
    borderBottom: 'var(--pf-hairline)',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.78rem',
  },
  routeBarTitle: {
    color: 'var(--pf-text)',
    fontWeight: 800,
  },
  routeBarPath: {
    color: 'var(--pf-text-secondary)',
  },
  routeBarPill: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    paddingRight: '12px',
    paddingLeft: '12px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: 600,
  },
  stage: {
    display: 'contents',
  },
  appFrame: {
    display: 'contents',
  },
  sidebar: {
    position: 'sticky',
    top: 0,
    alignSelf: 'start',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: 0,
    height: '100vh',
    padding: 'var(--pf-space-xl) 14px',
    backgroundColor: 'var(--pf-surface)',
    borderRight: 'var(--pf-hairline)',
    boxSizing: 'border-box',
    '@media (max-width: 1000px)': { display: 'none' },
  },
  sidebarCollapsed: {
    alignItems: 'center',
    paddingRight: '10px',
    paddingLeft: '10px',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-xxs) var(--pf-space-sm) 18px',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
    borderRadius: t.radius.md,
    transition: 'opacity var(--pf-motion-fast) var(--pf-motion-ease)',
    ':hover': { opacity: 0.82 },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '4px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  brandCollapsed: {
    justifyContent: 'center',
    width: '44px',
    paddingRight: 0,
    paddingLeft: 0,
  },
  brandMark: {
    width: '32px',
    height: '32px',
    borderRadius: '9px',
    objectFit: 'contain',
    flexShrink: 0,
  },
  brandText: { display: 'grid', gap: '2px' },
  collapsedHidden: {
    display: 'none',
  },
  brandTitle: {
    fontFamily: t.font.display,
    fontSize: '0.98rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1,
    color: 'var(--pf-text)',
  },
  brandSubtitle: {
    fontSize: '0.72rem',
    color: 'var(--pf-text-tertiary)',
    letterSpacing: '0.01em',
  },
  navGroupLabel: {
    fontSize: 'var(--pf-type-caption-size)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--pf-text-tertiary)',
    padding: 'var(--pf-space-md) 10px var(--pf-space-xs)',
    fontWeight: 600,
  },
  navGroupLabelCollapsed: {
    display: 'none',
  },
  navLink: {
    display: 'grid',
    gridTemplateColumns: '20px 1fr auto',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    minHeight: t.control.minHeight,
    padding: 'var(--pf-space-sm) 10px',
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    boxSizing: 'border-box',
    backgroundColor: 'transparent',
    textDecoration: 'none',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.88rem',
    fontWeight: 600,
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-line)',
      borderRightColor: 'var(--pf-line)',
      borderBottomColor: 'var(--pf-line)',
      borderLeftColor: 'var(--pf-line)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  navLinkCollapsed: {
    gridTemplateColumns: '1fr',
    justifyItems: 'center',
    gap: 0,
    width: '44px',
    minHeight: '44px',
    padding: 0,
    marginRight: 'auto',
    marginLeft: 'auto',
  },
  navIcon: { width: '18px', height: '18px' },
  navIconCollapsed: { width: '20px', height: '20px' },
  navHint: {
    fontSize: '0.7rem',
    fontWeight: 500,
    color: 'inherit',
    opacity: 0.7,
  },
  themeToggle: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2px',
    minWidth: 0,
    margin: 0,
    padding: '3px',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    boxSizing: 'border-box',
  },
  themeToggleButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--pf-space-xs)',
    minHeight: '32px',
    border: '1px solid transparent',
    borderRadius: '7px',
    backgroundColor: 'transparent',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.75rem',
    fontWeight: 800,
    transition:
      'background-color var(--pf-motion-fast), color var(--pf-motion-fast), border-color var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  themeToggleButtonActive: {
    backgroundColor: 'var(--pf-ink)',
    borderTopColor: 'var(--pf-ink)',
    borderRightColor: 'var(--pf-ink)',
    borderBottomColor: 'var(--pf-ink)',
    borderLeftColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.18)',
    ':hover': {
      backgroundColor: 'var(--pf-ink)',
      color: 'var(--pf-on-ink)',
    },
  },
  themeToggleIcon: { width: '15px', height: '15px', flexShrink: 0 },
  themeToggleCompactButton: {
    appearance: 'none',
    display: 'grid',
    placeItems: 'center',
    width: '44px',
    height: '44px',
    marginRight: 'auto',
    marginLeft: 'auto',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    transition:
      'background-color var(--pf-motion-fast), color var(--pf-motion-fast), border-color var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  userCard: {
    marginTop: 'auto',
    display: 'grid',
    gap: 'var(--pf-space-md)',
    padding: '10px',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
  },
  userCardCollapsed: {
    width: '52px',
    justifyItems: 'center',
    gap: '8px',
    padding: '8px 0',
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
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
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
    color: 'var(--pf-text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userEmail: {
    fontSize: '0.75rem',
    color: 'var(--pf-text-tertiary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userRole: {
    fontSize: '0.75rem',
    color: 'var(--pf-text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 700,
  },
  accountActions: {
    display: 'grid',
    gap: '4px',
    paddingTop: '8px',
    borderTop: 'var(--pf-hairline)',
  },
  accountAction: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--pf-space-sm)',
    minHeight: t.control.minHeight,
    padding: 'var(--pf-space-xs) var(--pf-space-sm)',
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 700,
    textAlign: 'left',
    textDecoration: 'none',
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface)',
      borderTopColor: 'var(--pf-line)',
      borderRightColor: 'var(--pf-line)',
      borderBottomColor: 'var(--pf-line)',
      borderLeftColor: 'var(--pf-line)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  accountActionCollapsed: {
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    minHeight: '36px',
    padding: 0,
  },
  accountActionIcon: { width: '16px', height: '16px', flexShrink: 0 },
  sidebarCollapseButton: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--pf-space-sm)',
    width: '100%',
    minHeight: t.control.minHeight,
    padding: 'var(--pf-space-xs) var(--pf-space-sm)',
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 800,
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-line)',
      borderRightColor: 'var(--pf-line)',
      borderBottomColor: 'var(--pf-line)',
      borderLeftColor: 'var(--pf-line)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  sidebarCollapseButtonCollapsed: {
    width: '44px',
    padding: 0,
  },
  sidebarCollapseIcon: { width: '18px', height: '18px', flexShrink: 0 },
  mobileAccountActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--pf-space-sm)',
  },
  mobileThemeToggle: {
    minWidth: '132px',
    '@media (max-width: 430px)': { minWidth: '108px' },
  },
  mobileUserPill: {
    display: 'grid',
    placeItems: 'center',
    width: '34px',
    height: '34px',
    borderRadius: '999px',
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    textDecoration: 'none',
    color: 'var(--pf-text)',
  },
  mobileAccountButton: {
    appearance: 'none',
    width: '34px',
    height: '34px',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text-secondary)',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    textDecoration: 'none',
    ':hover': {
      color: 'var(--pf-text)',
      backgroundColor: 'var(--pf-surface-muted)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
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
    minHeight: '100vh',
    backgroundColor: 'var(--pf-page)',
  },
  mobileTopBar: {
    display: 'none',
    '@media (max-width: 1000px)': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px var(--pf-space-lg)',
      backgroundColor: 'var(--pf-surface)',
      borderBottom: 'var(--pf-hairline)',
      position: 'sticky',
      top: 0,
      zIndex: 5,
    },
    '@media (max-width: 720px)': {
      padding: '10px 14px',
    },
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 'var(--pf-space-page-y) var(--pf-space-page-x) 120px',
    maxWidth: 'none',
    width: '100%',
    margin: 0,
    boxSizing: 'border-box',
    '@media (max-width: 1100px)': {
      padding: 'var(--pf-space-xxl) var(--pf-space-xxl) 120px',
    },
    '@media (max-width: 720px)': {
      padding: 'var(--pf-space-lg) 14px 110px',
    },
  },
  innerTopbar: {
    minHeight: '60px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 22px',
    backgroundColor: 'var(--pf-surface)',
    borderBottom: 'var(--pf-hairline)',
    '@media (max-width: 720px)': {
      display: 'none',
    },
  },
  innerTopbarTitle: {
    fontSize: '0.88rem',
    fontWeight: 800,
    color: 'var(--pf-text)',
  },
  trustChips: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    '@media (max-width: 720px)': { marginLeft: 0 },
  },
  trustChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '28px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    fontSize: '0.72rem',
    fontWeight: 600,
  },
  trustDot: {
    width: '7px',
    height: '7px',
    borderRadius: t.radius.pill,
    backgroundColor: 'var(--pf-risk-low-fg)',
  },
  trustDotSafe: {
    backgroundColor: 'var(--pf-status-info-fg)',
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
      backgroundColor: 'var(--pf-surface)',
      borderTop: 'var(--pf-hairline)',
      padding: 'var(--pf-space-sm) var(--pf-space-xs) var(--pf-space-md)',
      zIndex: 10,
    },
  },
  bottomNavLink: {
    display: 'grid',
    justifyItems: 'center',
    gap: '3px',
    minHeight: '52px',
    padding: 'var(--pf-space-xs) 2px',
    textDecoration: 'none',
    color: 'var(--pf-text-tertiary)',
    fontSize: '0.65rem',
    fontWeight: 600,
    borderRadius: t.radius.sm,
    border: '1px solid transparent',
    boxSizing: 'border-box',
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-line)',
      borderRightColor: 'var(--pf-line)',
      borderBottomColor: 'var(--pf-line)',
      borderLeftColor: 'var(--pf-line)',
      color: 'var(--pf-text)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '2px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  bottomNavIcon: { width: '22px', height: '22px' },
  voiceLauncher: {
    position: 'fixed',
    right: 'var(--pf-space-xxl)',
    bottom: 'var(--pf-space-xxl)',
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
      'transform var(--pf-motion-normal) var(--pf-motion-ease), filter var(--pf-motion-fast), box-shadow var(--pf-motion-normal)',
    animationName: {
      from: { opacity: 0, transform: 'translateY(18px) scale(0.5)' },
      '60%': { opacity: 1, transform: 'translateY(-2px) scale(1.06)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '420ms',
    animationTimingFunction: 'var(--pf-motion-spring)',
    animationFillMode: 'both',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    ':active': { transform: 'scale(0.92)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '4px',
      boxShadow:
        'var(--pf-focus-outline), 0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    '@media (max-width: 1000px)': {
      bottom: '150px',
      right: 'var(--pf-space-lg)',
      width: '48px',
      height: '48px',
    },
    '@media (max-width: 360px)': {
      bottom: '216px',
    },
  },
  voiceLauncherGlyph: { width: '24px', height: '24px' },
  chatLauncher: {
    position: 'fixed',
    right: 'var(--pf-space-xxl)',
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
      'transform var(--pf-motion-normal) var(--pf-motion-ease), filter var(--pf-motion-fast), box-shadow var(--pf-motion-normal)',
    animationName: {
      from: { opacity: 0, transform: 'translateY(18px) scale(0.5)' },
      '60%': { opacity: 1, transform: 'translateY(-2px) scale(1.06)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    animationDuration: '420ms',
    animationDelay: '60ms',
    animationTimingFunction: 'var(--pf-motion-spring)',
    animationFillMode: 'both',
    ':hover': {
      filter: 'brightness(1.08)',
      transform: 'translateY(-2px) scale(1.04)',
      boxShadow:
        '0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    ':active': { transform: 'scale(0.92)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '4px',
      boxShadow:
        'var(--pf-focus-outline), 0 18px 42px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)',
    },
    '@media (max-width: 1000px)': {
      bottom: '206px',
      right: 'var(--pf-space-lg)',
      width: '48px',
      height: '48px',
    },
    '@media (max-width: 360px)': {
      bottom: '272px',
    },
  },
  chatLauncherGlyph: { width: '24px', height: '24px' },
  chatPanel: {
    position: 'fixed',
    right: 'var(--pf-space-xxl)',
    bottom: '96px',
    zIndex: 45,
    width: 'min(420px, calc(100vw - 48px))',
    height: 'min(640px, calc(100vh - 140px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: t.radius.xl,
    border: '1px solid var(--scrim-card-line)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    background: 'var(--scrim-bg-voice-agent)',
    transformOrigin: 'bottom right',
    willChange: 'transform, opacity',
    transition:
      'right var(--pf-motion-slow) var(--pf-motion-ease), left var(--pf-motion-slow) var(--pf-motion-ease), top var(--pf-motion-slow) var(--pf-motion-ease), bottom var(--pf-motion-slow) var(--pf-motion-ease), width var(--pf-motion-slow) var(--pf-motion-ease), height var(--pf-motion-slow) var(--pf-motion-ease)',
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
      to: {
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        filter: 'blur(0)',
      },
    },
    animationDuration: '320ms',
    animationTimingFunction: 'var(--pf-motion-ease)',
    animationFillMode: 'both',
    '@media (max-width: 1000px)': {
      right: '12px',
      bottom: '88px',
      width: 'calc(100vw - 24px)',
    },
  },
  chatPanelClosing: {
    animationName: {
      from: {
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        filter: 'blur(0)',
      },
      to: {
        opacity: 0,
        transform: 'translateY(16px) scale(0.86)',
        filter: 'blur(4px)',
      },
    },
    animationDuration: 'var(--pf-motion-slow)',
    animationTimingFunction: 'var(--pf-motion-ease)',
    animationFillMode: 'forwards',
    pointerEvents: 'none',
  },
  chatPanelExpanded: {
    right: 'var(--pf-space-xxl)',
    left: 'var(--pf-space-xxl)',
    top: 'var(--pf-space-xxl)',
    bottom: 'var(--pf-space-xxl)',
    width: 'auto',
    height: 'auto',
    transition:
      'right var(--pf-motion-slow) var(--pf-motion-ease), left var(--pf-motion-slow) var(--pf-motion-ease), top var(--pf-motion-slow) var(--pf-motion-ease), bottom var(--pf-motion-slow) var(--pf-motion-ease), width var(--pf-motion-slow) var(--pf-motion-ease), height var(--pf-motion-slow) var(--pf-motion-ease)',
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
    background: 'var(--scrim-card)',
    borderBottom: '1px solid var(--scrim-card-line)',
    color: 'var(--scrim-fg-strong)',
  },
  chatPanelTitle: {
    fontFamily: t.font.text,
    fontSize: 'var(--pf-type-caption-size)',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  chatPanelMinimize: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'var(--scrim-fg-strong)',
    cursor: 'pointer',
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    ':hover': { background: 'rgba(255,255,255,0.08)' },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--scrim-fg-strong)',
      outlineOffset: '2px',
    },
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
    gap: 'var(--pf-space-lg)',
    alignItems: 'center',
    padding: 'var(--pf-space-lg) 18px',
    borderRadius: t.radius.sm,
    backgroundColor: 'var(--pf-surface)',
    borderTop: 'var(--pf-hairline)',
    borderRight: 'var(--pf-hairline)',
    borderBottom: 'var(--pf-hairline)',
    borderLeft: 'var(--pf-hairline)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
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
      gap: 'var(--pf-space-md)',
      padding: '14px',
    },
    '@media (max-width: 560px)': {
      right: '12px',
      bottom: '154px',
    },
  },
  cookieBannerCopy: {
    display: 'grid',
    gap: 'var(--pf-space-xs)',
    minWidth: 0,
  },
  cookieBannerTitle: {
    fontFamily: t.font.display,
    fontSize: '0.95rem',
    fontWeight: 700,
    color: 'var(--pf-text)',
  },
  cookieBannerText: {
    fontSize: 'var(--pf-type-caption-size)',
    lineHeight: 'var(--pf-type-caption-line)',
    color: 'var(--pf-text-secondary)',
  },
  cookieBannerActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--pf-space-sm)',
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
    minHeight: t.control.minHeight,
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 700,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  cookieButtonPrimary: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: t.control.minHeight,
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 700,
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
})

export function CookieConsentBanner({
  onResolved,
}: {
  onResolved?: () => void
} = {}) {
  const styles = useStyles()
  const [visible, setVisible] = useState(
    () => getStoredCookieConsent() === null
  )

  const dismiss = (choice: 'accepted' | 'managed') => {
    storeCookieConsent(choice)
    setVisible(false)
    onResolved?.()
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
          Wulo uses essential cookies for the app to work. Analytics stay off
          unless you choose to manage preferences later.
        </Text>
      </div>
      <div className={styles.cookieBannerActions}>
        <button
          type="button"
          className={styles.cookieButton}
          onClick={() => dismiss('managed')}
        >
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
  return (
    <PathfinderThemeProvider>
      <PathfinderLearnAppShell />
    </PathfinderThemeProvider>
  )
}

function PathfinderLearnAppShell() {
  usePathfinderThemeStyles()
  const styles = useStyles()
  const { mode, setMode, toggle: toggleTheme } = usePathfinderTheme()
  const fluentTheme =
    mode === 'dark' ? pathfinderFluentThemeDark : pathfinderFluentTheme
  const location = useLocation()
  const navigate = useNavigate()
  const [authStatus, setAuthStatus] = useState<
    'loading' | 'authenticated' | 'unauthenticated'
  >('loading')
  const [learningRole, setLearningRole] = useState<LearningRole | 'loading'>(
    'loading'
  )
  const [learnerChildren, setLearnerChildren] = useState<ChildProfile[] | null>(
    null
  )
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    getStoredSidebarCollapsed
  )
  // Sequence first-run dismissables (#19): hold the onboarding tour until the
  // cookie banner has been resolved, so they never stack on first load.
  const [cookieConsentResolved, setCookieConsentResolved] = useState(
    () => getStoredCookieConsent() !== null
  )
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
  const { selectedLearnerId, setSelectedLearnerId } = useSelectedLearner(
    learnerChildren ?? []
  )
  const handleParentChildCreated = useCallback(
    (child: ChildProfile) => {
      setLearnerChildren(prev => [...(prev ?? []), child])
      storeSelectedLearnerId(child.id)
      setSelectedLearnerId(child.id)
    },
    [setSelectedLearnerId]
  )
  const effectiveRole = learningRole === 'loading' ? 'learner' : learningRole
  const visibleNavItems =
    learningRole === 'loading' ? [] : navItemsForRole(effectiveRole)
  const voiceLauncherVisible =
    !!appConfig?.voice_agent_fullscreen_enabled &&
    (appConfig?.insights_voice_mode ?? 'off') !== 'off'
  const chatLauncherVisible = !!appConfig?.insights_rail_enabled
  const practiceFullscreenEnabled =
    !!appConfig?.learner_voice_fullscreen_enabled &&
    ['learner', 'kid', 'student'].includes(effectiveRole)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [onboardingTextMode, setOnboardingTextMode] = useState(false)
  const activeLearnerIdForPractice =
    selectedLearnerId ?? learnerChildren?.[0]?.id ?? null
  const selectedLearnerName =
    learnerChildren?.find(
      child => child.id === activeLearnerIdForPractice
    )?.name ?? null
  const [learnerSetup] = useLearnerSetup()
  const askPathfinderLearnerId =
    activeLearnerIdForPractice ?? authSession?.user_id ?? null
  const askPathfinderContextValue = useMemo(
    () => ({
      ...defaultLearnerContext,
      userId: askPathfinderLearnerId,
      learnerSetup:
        learnerSetup.subject || learnerSetup.year
          ? {
              subject: learnerSetup.subject,
              yearGroup: learnerSetup.year,
            }
          : null,
    }),
    [askPathfinderLearnerId, learnerSetup.subject, learnerSetup.year]
  )
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(current => {
      const next = !current
      storeSidebarCollapsed(next)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .getConfig()
      .then(cfg => {
        if (!cancelled) setAppConfig(cfg)
      })
      .catch(() => {
        if (!cancelled) setAppConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .getAuthSession()
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
    api
      .getChildren(authSession.current_workspace_id)
      .then(children => {
        if (!cancelled) setLearnerChildren(children)
      })
      .catch(() => {
        if (!cancelled) setLearnerChildren([])
      })
    return () => {
      cancelled = true
    }
  }, [
    authSession?.authenticated,
    authSession?.current_workspace_id,
    effectiveRole,
    learnerChildren,
  ])

  // When a self-service learner lands with no children yet, auto-create their
  // self-learner profile so they can start practising immediately.
  useEffect(() => {
    if (effectiveRole !== 'learner') return
    if (!authSession?.authenticated) return
    if (learnerChildren === null) return
    if (learnerChildren.length > 0) return
    let cancelled = false
    api
      .createSelfLearner()
      .then(child => {
        if (cancelled) return
        storeSelectedLearnerId(child.id)
        setLearnerChildren([child])
      })
      .catch(() => {
        /* LearnerEmptyState remains as fallback */
      })
    return () => {
      cancelled = true
    }
  }, [effectiveRole, authSession?.authenticated, learnerChildren])

  const handleOnboardingChosen = useCallback((session: AuthSession) => {
    setAuthStatus('authenticated')
    setAuthSession(session)
    setLearningRole(normalizeLearningRole(session.role))
    // Force a children refetch on next render path
    setLearnerChildren(null)
  }, [])

  const routeForRole = (
    allowedRoles: LearningRole[],
    element: JSX.Element | null
  ) => {
    if (learningRole === 'loading') return null
    return allowedRoles.includes(effectiveRole) ? (
      element
    ) : (
      <Navigate to={defaultPathForRole(effectiveRole)} replace />
    )
  }

  const learnerHomeElement = () => {
    // A learner-like role is never shown the parent/therapist "no learners
    // linked" empty state. While their self-learner profile is being
    // auto-provisioned (see effect above) or the children list is loading,
    // render their own learner home; it self-bootstraps once a child exists.
    if (learnerChildren === null || learnerChildren.length === 0) {
      return (
        <StudentLearningHome
          key="learner-loading"
          studentId={selectedLearnerId ?? learnerChildren?.[0]?.id ?? null}
          learnerTutorEnabled={['learner', 'kid', 'student'].includes(
            effectiveRole
          )}
          pushConsentDeferred={effectiveRole === 'kid'}
        />
      )
    }
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
          learnerTutorEnabled={['learner', 'kid', 'student'].includes(
            effectiveRole
          )}
          pushConsentDeferred={effectiveRole === 'kid'}
        />
      </>
    )
  }

  const onboardingFlagEnabled =
    featureFlags.pathfinder_learner_onboarding_enabled
  const isLearnerLikeRole = ['learner', 'kid', 'student'].includes(
    effectiveRole
  )
  const learnerProfileGate = useLearnerProfile()
  const learnerProfileGateLoading =
    onboardingFlagEnabled && isLearnerLikeRole && learnerProfileGate.isLoading
  const learnerNeedsOnboarding =
    onboardingFlagEnabled &&
    isLearnerLikeRole &&
    !learnerProfileGateLoading &&
    learnerProfileGate.needsOnboarding

  const welcomeRouteElement = () => {
    if (!onboardingFlagEnabled || !isLearnerLikeRole) {
      return <Navigate to={defaultPathForRole(effectiveRole)} replace />
    }
    // Voice-first onboarding (consent gate → narrated profile + goals) when the
    // goal-intake flag is on, with a one-tap fall back to the classic typed
    // wizard. The classic wizard then hands off to /goals so a text learner
    // still sets a goal.
    if (featureFlags.pathfinder_goal_intake_enabled && !onboardingTextMode) {
      return (
        <VoiceOnboardingFlow
          studentId={activeLearnerIdForPractice ?? ''}
          profile={learnerProfileGate.profile}
          patch={learnerProfileGate.patch}
          recordConsent={learnerProfileGate.recordConsent}
          onComplete={() => navigate('/home')}
          onStartPractice={(skillId) =>
            navigate(
              skillId
                ? `/home?startPractice=1&skillId=${encodeURIComponent(skillId)}`
                : '/home?startPractice=1'
            )
          }
          onUseTextInstead={() => setOnboardingTextMode(true)}
        />
      )
    }
    return (
      <LearnerOnboardingWizard
        profile={learnerProfileGate.profile}
        isLoading={learnerProfileGate.isLoading}
        patch={learnerProfileGate.patch}
        recordConsent={learnerProfileGate.recordConsent}
        onComplete={
          featureFlags.pathfinder_goal_intake_enabled
            ? () => navigate('/goals')
            : undefined
        }
      />
    )
  }

  const goalsRouteElement = () => {
    if (
      !onboardingFlagEnabled ||
      !isLearnerLikeRole ||
      !featureFlags.pathfinder_goal_intake_enabled
    ) {
      return <Navigate to={defaultPathForRole(effectiveRole)} replace />
    }
    // Goal intake is a post-onboarding step: a learner who still needs
    // onboarding must finish the wizard first, otherwise completing goals would
    // bounce to /home → back to /welcome ("Step 1 of 3") and invert the order.
    if (learnerProfileGateLoading) return null
    if (learnerNeedsOnboarding) return <Navigate to="/welcome" replace />
    return (
      <GoalIntakeScreen
        studentId={activeLearnerIdForPractice ?? ''}
        onStart={(skillId) =>
          navigate(
            skillId
              ? `/home?startPractice=1&skillId=${encodeURIComponent(skillId)}`
              : '/home?startPractice=1'
          )
        }
        onSaveForLater={() => navigate('/home')}
        onDone={() => navigate('/home')}
      />
    )
  }

  const homeRouteElement = () => {
    if (learnerProfileGateLoading) return null
    if (learnerNeedsOnboarding) return <Navigate to="/welcome" replace />
    return routeForRole(
      ['learner', 'kid', 'student'],
      learnerHomeElement()
    )
  }

  const renderNavLinks = (extraClass?: string) =>
    visibleNavItems.map(item => {
      const Icon = item.icon
      const compact = !extraClass && sidebarCollapsed
      return (
        <NavLink
          key={item.to}
          to={item.to}
          data-testid={item.testId}
          className={mergeClasses(
            extraClass ?? styles.navLink,
            compact && styles.navLinkCollapsed
          )}
          title={compact ? item.label : undefined}
          style={({ isActive }) =>
            isActive
              ? {
                  backgroundColor: 'var(--pf-ink)',
                  borderColor: 'var(--pf-ink)',
                  color: 'var(--pf-on-ink)',
                  boxShadow: extraClass
                    ? 'none'
                    : '0 1px 2px rgba(0, 0, 0, 0.18)',
                }
              : undefined
          }
        >
          <Icon
            className={mergeClasses(
              extraClass ? styles.bottomNavIcon : styles.navIcon,
              compact && styles.navIconCollapsed
            )}
            aria-hidden="true"
          />
          {compact ? <span className={styles.srOnly}>{item.label}</span> : item.label}
          {!extraClass && !compact && (
            <span className={styles.navHint}>{item.hint}</span>
          )}
        </NavLink>
      )
    })

  const renderThemeToggle = (
    testId: string,
    extraClass?: string,
    compact = false
  ) => {
    if (compact) {
      const nextMode = mode === 'dark' ? 'light' : 'dark'
      const ThemeIcon = mode === 'dark' ? MoonIcon : SunIcon
      return (
        <button
          type="button"
          className={styles.themeToggleCompactButton}
          data-testid={testId}
          aria-label={`Switch to ${nextMode} theme`}
          title={`Switch to ${nextMode} theme`}
          onClick={toggleTheme}
        >
          <ThemeIcon className={styles.themeToggleIcon} aria-hidden="true" />
        </button>
      )
    }
    return (
      <fieldset
        className={mergeClasses(styles.themeToggle, extraClass)}
        data-testid={testId}
      >
        <legend className={styles.srOnly}>Theme</legend>
        <button
          type="button"
          className={mergeClasses(
            styles.themeToggleButton,
            mode === 'light' && styles.themeToggleButtonActive
          )}
          aria-pressed={mode === 'light'}
          onClick={() => setMode('light')}
        >
          <SunIcon className={styles.themeToggleIcon} aria-hidden="true" />
          <span>Light</span>
        </button>
        <button
          type="button"
          className={mergeClasses(
            styles.themeToggleButton,
            mode === 'dark' && styles.themeToggleButtonActive
          )}
          aria-pressed={mode === 'dark'}
          onClick={() => setMode('dark')}
        >
          <MoonIcon className={styles.themeToggleIcon} aria-hidden="true" />
          <span>Dark</span>
        </button>
      </fieldset>
    )
  }

  const routeTitleByPath: Record<string, string> = {
    '/': 'Welcome · role picker',
    '/welcome': 'Welcome · role picker',
    '/goals': 'Goal intake · orb',
    '/home': 'Learning home',
    '/family': 'Parent family home',
    '/teacher': 'Teacher mastery heatmap',
    '/exam-prep': 'Exam prep + diagnostic',
    '/library': 'Skill library',
    '/profile': 'Mastery profile',
    '/pathways': 'Pathways explorer',
    '/safety': 'Trust & safety console',
    '/observability': 'Observability dashboard',
    '/account': 'Account & settings',
    '/account/settings': 'Settings',
    '/account/privacy': 'Privacy',
    '/account/terms': 'Terms',
    '/account/ai-notice': 'AI notice',
  }
  const routeChromeTitle =
    routeTitleByPath[location.pathname] ??
    (location.pathname.startsWith('/exam-prep')
      ? routeTitleByPath['/exam-prep']
      : 'Wulo Academy')
  const innerChromeTitle =
    visibleNavItems.find(
      item =>
        location.pathname === item.to ||
        location.pathname.startsWith(`${item.to}/`)
    )?.label ?? routeChromeTitle

  const renderAccountCard = (compact = false) => {
    if (!authSession?.authenticated) return null
    const accountInitial = (authSession.name || authSession.email || '?')
      .charAt(0)
      .toUpperCase()
    if (compact) {
      return (
        <div
          className={mergeClasses(styles.userCard, styles.userCardCollapsed)}
          data-testid="sidebar-user-card"
        >
          <span
            className={styles.userAvatar}
            aria-label={authSession.name || authSession.email || 'User'}
            title={authSession.name || authSession.email || 'User'}
          >
            {accountInitial}
          </span>
          <a
            href="/account"
            className={mergeClasses(
              styles.accountAction,
              styles.accountActionCollapsed
            )}
            aria-label="Account & settings"
            title="Account & settings"
            data-testid="account-actions-trigger"
          >
            <Cog6ToothIcon
              className={styles.accountActionIcon}
              aria-hidden="true"
            />
            <span className={styles.srOnly}>Account & settings</span>
          </a>
          <a
            href="/logout"
            className={mergeClasses(
              styles.accountAction,
              styles.accountActionCollapsed
            )}
            aria-label="Sign out"
            title="Sign out"
            data-testid="account-action-sign-out"
          >
            <ArrowRightStartOnRectangleIcon
              className={styles.accountActionIcon}
              aria-hidden="true"
            />
            <span className={styles.srOnly}>Sign out</span>
          </a>
        </div>
      )
    }
    return (
      <div className={styles.userCard} data-testid="sidebar-user-card">
        <div className={styles.userHeader}>
          <span className={styles.userAvatar} aria-hidden="true">
            {accountInitial}
          </span>
          <div className={styles.userInfo}>
            <Text className={styles.userName}>
              {authSession.name || 'User'}
            </Text>
            {authSession.email ? (
              <Text className={styles.userEmail}>{authSession.email}</Text>
            ) : null}
            <Text className={styles.userRole}>
              {formatRoleLabel(effectiveRole)}
            </Text>
          </div>
        </div>
        <a
          href="/account"
          className={styles.accountAction}
          data-testid="account-actions-trigger"
        >
          <Cog6ToothIcon
            className={styles.accountActionIcon}
            aria-hidden="true"
          />
          <span>Account & settings</span>
        </a>
        <a
          href="/logout"
          className={styles.accountAction}
          data-testid="account-action-sign-out"
        >
          <ArrowRightStartOnRectangleIcon
            className={styles.accountActionIcon}
            aria-hidden="true"
          />
          <span>Sign out</span>
        </a>
      </div>
    )
  }

  if (effectiveRole === 'unassigned' && authSession?.authenticated) {
    return (
      <FluentProvider
        theme={fluentTheme}
        className={styles.provider}
        data-theme={mode}
      >
        <WelcomeRolePicker onChosen={handleOnboardingChosen} />
      </FluentProvider>
    )
  }

  if (authStatus === 'unauthenticated') {
    return (
      <Navigate to={{ pathname: '/login', search: location.search }} replace />
    )
  }

  return (
    <FluentProvider
      theme={fluentTheme}
      className={styles.provider}
      data-theme={mode}
    >
      <OnboardingRuntime
        role={authSession?.role ?? null}
        userMode="workspace"
        toursEnabled={
          (appConfig?.onboarding?.tours_enabled ?? true) &&
          cookieConsentResolved
        }
        authenticated={authStatus === 'authenticated'}
      >
      <div
        className={mergeClasses(
          styles.page,
          sidebarCollapsed && styles.pageSidebarCollapsed
        )}
        data-testid="pathfinder-learn-app"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        <div className={styles.routeBar} aria-label="Current Wulo Academy route">
          <span className={styles.routeBarTitle}>{routeChromeTitle}</span>
          <span className={styles.routeBarPath}>
            {location.pathname === '/' ? 'entry · /' : location.pathname}
          </span>
          <span className={styles.routeBarPill}>
            {formatRoleLabel(effectiveRole)}
          </span>
        </div>

        <div className={styles.stage}>
          <div className={styles.appFrame}>
        <aside
          className={mergeClasses(
            styles.sidebar,
            sidebarCollapsed && styles.sidebarCollapsed
          )}
          aria-label="Wulo Academy primary"
        >
          <NavLink
            to="/home"
            className={mergeClasses(
              styles.brand,
              sidebarCollapsed && styles.brandCollapsed
            )}
            aria-label="Wulo Academy — go to home"
            title="Wulo Academy"
          >
            <img
              src="/wulo-logo.png?v=2"
              alt=""
              aria-hidden="true"
              className={styles.brandMark}
            />
            <div
              className={mergeClasses(
                styles.brandText,
                sidebarCollapsed && styles.collapsedHidden
              )}
            >
              <Text className={styles.brandTitle}>Wulo Academy</Text>
            </div>
          </NavLink>

          <div
            className={mergeClasses(
              styles.navGroupLabel,
              sidebarCollapsed && styles.navGroupLabelCollapsed
            )}
          >
            Workspaces
          </div>
          <nav
            aria-label="Wulo Academy views"
            style={{ display: 'grid', gap: '2px' }}
          >
            {renderNavLinks()}
            {practiceFullscreenEnabled && activeLearnerIdForPractice ? (
              <button
                type="button"
                className={mergeClasses(
                  styles.navLink,
                  sidebarCollapsed && styles.navLinkCollapsed
                )}
                onClick={() => setPracticeOpen(true)}
                aria-label="Open Wulo Academy practice"
                title="Practice"
                data-testid="sidebar-practice-link"
                style={{
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <BookOpenIcon
                  className={mergeClasses(
                    styles.navIcon,
                    sidebarCollapsed && styles.navIconCollapsed
                  )}
                  aria-hidden="true"
                />
                {sidebarCollapsed ? (
                  <span className={styles.srOnly}>Practice</span>
                ) : (
                  'Practice'
                )}
                {!sidebarCollapsed && <span className={styles.navHint}>Cards</span>}
              </button>
            ) : null}
          </nav>

          {renderThemeToggle(
            'pathfinder-theme-toggle',
            undefined,
            sidebarCollapsed
          )}

          {authSession?.authenticated && !sidebarCollapsed ? (
            <HelpMenu
              currentRole={authSession.role ?? null}
              directReplayTourId={
                location.pathname === '/home' &&
                ['learner', 'kid', 'student'].includes(effectiveRole)
                  ? 'welcome-learner'
                  : undefined
              }
              onReplayTour={tourId => requestReplayTour(tourId)}
            />
          ) : null}

          {renderAccountCard(sidebarCollapsed)}

          <button
            type="button"
            className={mergeClasses(
              styles.sidebarCollapseButton,
              sidebarCollapsed && styles.sidebarCollapseButtonCollapsed
            )}
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            data-testid="sidebar-collapse-toggle"
          >
            {sidebarCollapsed ? (
              <ChevronDoubleRightIcon
                className={styles.sidebarCollapseIcon}
                aria-hidden="true"
              />
            ) : (
              <ChevronDoubleLeftIcon
                className={styles.sidebarCollapseIcon}
                aria-hidden="true"
              />
            )}
            {sidebarCollapsed ? null : <span>Collapse sidebar</span>}
          </button>
        </aside>

        <main className={styles.main}>
          <div className={styles.mobileTopBar}>
            <NavLink
              to="/home"
              className={styles.brand}
              style={{ padding: 0 }}
              aria-label="Wulo Academy — go to home"
            >
              <img
                src="/wulo-logo.png?v=2"
                alt=""
                aria-hidden="true"
                className={styles.brandMark}
              />
              <div className={styles.brandText}>
                <Text className={styles.brandTitle}>Wulo Academy</Text>
              </div>
            </NavLink>
            {authSession?.authenticated ? (
              <div className={styles.mobileAccountActions}>
                {renderThemeToggle(
                  'pathfinder-theme-toggle-mobile',
                  styles.mobileThemeToggle
                )}
                <a
                  href="/account"
                  className={styles.mobileAccountButton}
                  aria-label="Open account and settings"
                  title="Account & settings"
                  data-testid="mobile-account-settings"
                >
                  <Cog6ToothIcon
                    className={styles.mobileAccountIcon}
                    aria-hidden="true"
                  />
                  <span className={styles.srOnly}>Account & settings</span>
                </a>
                <a
                  href="/logout"
                  className={styles.mobileAccountButton}
                  aria-label="Sign out"
                  title="Sign out"
                  data-testid="mobile-account-sign-out"
                >
                  <ArrowRightStartOnRectangleIcon
                    className={styles.mobileAccountIcon}
                    aria-hidden="true"
                  />
                  <span className={styles.srOnly}>Sign out</span>
                </a>
              </div>
            ) : null}
          </div>

          <div className={styles.innerTopbar}>
            <div className={styles.innerTopbarTitle}>{innerChromeTitle}</div>
            <div className={styles.trustChips} aria-label="Wulo Academy status">
              <span
                className={styles.trustChip}
                data-testid="offline-ready-pill"
              >
                <span className={styles.trustDot} aria-hidden="true" />
                Works offline · synced
              </span>
              <span className={styles.trustChip}>
                <span
                  className={mergeClasses(styles.trustDot, styles.trustDotSafe)}
                  aria-hidden="true"
                />
                Safeguarding active
              </span>
              <span className={styles.trustChip}>
                <span className={styles.trustDot} aria-hidden="true" />
                Wulo Tutor ready
              </span>
            </div>
          </div>

          <div className={styles.content}>
            <Routes>
              <Route
                index
                element={
                  learningRole === 'loading' ? null : (
                    <Navigate to={defaultPathForRole(effectiveRole)} replace />
                  )
                }
              />
              <Route
                path="/logout"
                element={<Navigate to="/.auth/logout" replace />}
              />
              <Route path="/welcome" element={welcomeRouteElement()} />
              <Route path="/goals" element={goalsRouteElement()} />
              <Route path="/home" element={homeRouteElement()} />
              <Route
                path="/family"
                element={routeForRole(
                  ['parent'],
                  <ParentFamilyHome
                    learners={learnerChildren}
                    selectedLearnerId={
                      selectedLearnerId ?? learnerChildren?.[0]?.id ?? null
                    }
                    onSelectLearner={setSelectedLearnerId}
                    onChildCreated={handleParentChildCreated}
                  />
                )}
              />
              <Route
                path="/teacher"
                element={routeForRole(
                  ['therapist', 'admin'],
                  <TeacherMasteryDashboard />
                )}
              />
              <Route
                path="/exam-prep/*"
                element={routeForRole(
                  ['parent', 'learner', 'kid', 'student'],
                  <ExamPrepLibrary
                    studentId={
                      selectedLearnerId ?? learnerChildren?.[0]?.id ?? null
                    }
                  />
                )}
              />
              <Route
                path="/library"
                element={routeForRole(['admin'], <SkillLibrary />)}
              />
              <Route
                path="/profile"
                element={routeForRole(
                  ['parent', 'learner', 'kid', 'student', 'admin'],
                  <StudentMasteryProfile
                    role={effectiveRole}
                    learnerName={selectedLearnerName}
                    studentId={activeLearnerIdForPractice}
                    learners={learnerChildren ?? undefined}
                    onSelectStudent={setSelectedLearnerId}
                  />
                )}
              />
              <Route
                path="/pathways"
                element={routeForRole(
                  ['parent', 'learner', 'kid', 'student', 'admin'],
                  <PathwaysExplorer
                    studentId={activeLearnerIdForPractice ?? undefined}
                  />
                )}
              />
              <Route
                path="/safety"
                element={routeForRole(['admin'], <TrustSafetyConsole />)}
              />
              <Route
                path="/observability"
                element={routeForRole(['admin'], <ObservabilityDashboard />)}
              />
              <Route path="/account" element={<PathfinderAccountHub />} />
              <Route
                path="/account/settings"
                element={<PathfinderSettings />}
              />
              <Route path="/account/privacy" element={<PathfinderPrivacy />} />
              <Route path="/account/terms" element={<PathfinderTerms />} />
              <Route
                path="/account/ai-notice"
                element={<PathfinderAiNotice />}
              />
              <Route
                path="*"
                element={
                  learningRole === 'loading' ? null : (
                    <Navigate to={defaultPathForRole(effectiveRole)} replace />
                  )
                }
              />
            </Routes>
          </div>

          <nav
            className={styles.bottomNav}
            aria-label="Wulo Academy bottom nav"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, visibleNavItems.length)}, 1fr)`,
            }}
          >
            {renderNavLinks(styles.bottomNavLink)}
          </nav>
        </main>
          </div>
        {['learner', 'kid', 'student'].includes(effectiveRole) && (
          <LearnerContext.Provider value={askPathfinderContextValue}>
            <AskPathfinder
              voiceLiveEnabled={!!appConfig?.pathfinder_voicelive_enabled}
            />
          </LearnerContext.Provider>
        )}
        {practiceFullscreenEnabled &&
          activeLearnerIdForPractice &&
          !practiceOpen && (
            <button
              type="button"
              className={styles.voiceLauncher}
              onClick={() => setPracticeOpen(true)}
              aria-label="Open Wulo Academy practice"
              data-testid="practice-launcher"
            >
              <BookOpenIcon
                className={styles.voiceLauncherGlyph}
                aria-hidden="true"
              />
            </button>
          )}
        {practiceFullscreenEnabled &&
          activeLearnerIdForPractice &&
          practiceOpen && (
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
            aria-label="Open Wulo Academy voice assistant"
            data-testid="voice-agent-launcher"
          >
            <MicrophoneIcon
              className={styles.voiceLauncherGlyph}
              aria-hidden="true"
            />
          </button>
        )}
        {chatLauncherVisible && !chatOpen && (
          <button
            type="button"
            className={styles.chatLauncher}
            onClick={() => setChatOpen(true)}
            aria-label="Ask Wulo Tutor"
            title="Ask Wulo Tutor"
            data-testid="pathfinder-chat-launcher"
          >
            <ChatBubbleLeftRightIcon
              className={styles.chatLauncherGlyph}
              aria-hidden="true"
            />
          </button>
        )}
        {chatLauncherVisible && chatOpen && (
          <aside
            className={mergeClasses(
              styles.chatPanel,
              chatExpanded && styles.chatPanelExpanded,
              chatClosing && styles.chatPanelClosing
            )}
            aria-label="Wulo Tutor"
            data-testid="pathfinder-chat-panel"
          >
            <header className={styles.chatPanelHeader}>
              <span className={styles.chatPanelTitle}>
                Wulo Tutor
              </span>
              <button
                type="button"
                className={styles.chatPanelMinimize}
                onClick={closeChatPanel}
                aria-label="Minimize assistant"
                data-testid="pathfinder-chat-minimize"
              >
                <MinusIcon
                  className={styles.chatPanelMinimizeGlyph}
                  aria-hidden="true"
                />
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
        <CookieConsentBanner
          onResolved={() => setCookieConsentResolved(true)}
        />
        </div>
      </div>
      </OnboardingRuntime>
    </FluentProvider>
  )
}
