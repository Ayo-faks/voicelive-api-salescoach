import { useEffect, useState } from 'react'
import { FluentProvider, Text, makeStyles } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  BookOpenIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { MicrophoneIcon } from '@heroicons/react/24/solid'
import { api, type AuthSession } from '../services/api'
import type { AppConfig, ChildProfile } from '../types'
import LearnerEmptyState from './components/LearnerEmptyState'
import LearnerSelector from './components/LearnerSelector'
import VoiceAgentFullscreen from './components/VoiceAgentFullscreen'
import { useSelectedLearner } from './hooks/useSelectedLearner'
import PathwaysExplorer from './routes/PathwaysExplorer'
import SkillLibrary from './routes/SkillLibrary'
import StudentLearningHome from './routes/StudentLearningHome'
import StudentMasteryProfile from './routes/StudentMasteryProfile'
import TeacherMasteryDashboard from './routes/TeacherMasteryDashboard'
import TrustSafetyConsole from './routes/TrustSafetyConsole'
import { pathfinderFluentTheme } from './theme/pathfinderFluentTheme'
import { pathfinderTokens as t } from './theme/pathfinder-tokens'

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

export type LearningRole = AuthSession['role'] | 'learner' | 'kid' | 'student'

const navItems: NavItem[] = [
  { to: '/home', label: 'Learner', hint: 'Today', icon: AcademicCapIcon, allowedRoles: ['parent', 'learner', 'kid', 'student'] },
  { to: '/teacher', label: 'Teacher', hint: 'Class', icon: ChartBarIcon, allowedRoles: ['therapist', 'admin'] },
  { to: '/library', label: 'Library', hint: 'Skills', icon: BookOpenIcon, allowedRoles: ['admin'] },
  { to: '/profile', label: 'Profile', hint: 'Insights', icon: UserCircleIcon, allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'] },
  { to: '/pathways', label: 'Pathways', hint: 'Explore', icon: MagnifyingGlassIcon, allowedRoles: ['parent', 'learner', 'kid', 'student', 'admin'] },
  { to: '/safety', label: 'Trust & Safety', hint: 'Console', icon: ShieldCheckIcon, allowedRoles: ['admin'] },
]

export function normalizeLearningRole(role: string | null | undefined): LearningRole {
  if (role === 'therapist' || role === 'parent' || role === 'admin' || role === 'pending_therapist') {
    return role
  }
  if (role === 'kid' || role === 'student' || role === 'learner') {
    return role
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
    transition: 'transform .15s ease, filter .15s ease, box-shadow .15s ease',
    ':hover': { filter: 'brightness(1.06)' },
    ':active': { transform: 'scale(0.96)' },
    '@media (max-width: 1000px)': {
      bottom: '88px',
      right: '16px',
      width: '54px',
      height: '54px',
    },
  },
  voiceLauncherGlyph: { width: '24px', height: '24px' },
  cookieBanner: {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: 30,
    pointerEvents: 'auto',
    width: 'min(520px, calc(100vw - 32px))',
    maxHeight: '35vh',
    overflowY: 'auto',
    display: 'grid',
    gap: '12px',
    padding: '16px',
    borderRadius: '8px',
    backgroundColor: t.brand.surface,
    borderTop: t.surface.hairline,
    borderRight: t.surface.hairline,
    borderBottom: t.surface.hairline,
    borderLeft: t.surface.hairline,
    boxShadow: '0 18px 48px rgba(30, 41, 59, 0.22)',
    boxSizing: 'border-box',
    '@media (max-width: 1000px)': {
      right: '12px',
      bottom: '88px',
      width: 'calc(100vw - 24px)',
      maxHeight: '30vh',
    },
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
      <div className={styles.cookieBannerTitle}>We use cookies</div>
      <Text className={styles.cookieBannerText}>
        Wulo uses essential cookies for the app to work. Analytics stay off unless
        you choose to manage preferences later.
      </Text>
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
  const [learningRole, setLearningRole] = useState<LearningRole | 'loading'>('loading')
  const [learnerChildren, setLearnerChildren] = useState<ChildProfile[] | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const { selectedLearnerId, setSelectedLearnerId } = useSelectedLearner(learnerChildren ?? [])
  const effectiveRole = learningRole === 'loading' ? 'learner' : learningRole
  const visibleNavItems = learningRole === 'loading' ? [] : navItemsForRole(effectiveRole)
  const voiceLauncherVisible =
    !!appConfig?.voice_agent_fullscreen_enabled &&
    (appConfig?.insights_voice_mode ?? 'off') !== 'off'

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
        const nextRole = normalizeLearningRole(session.role)
        if (!cancelled) setLearningRole(nextRole)
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
          setLearningRole('learner')
          setLearnerChildren([])
        }
      })
    return () => {
      cancelled = true
    }
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
    return (
      <>
        <LearnerSelector
          learners={learnerChildren}
          selectedLearnerId={selectedLearnerId}
          onChange={setSelectedLearnerId}
        />
        <StudentLearningHome key={selectedLearnerId ?? 'no-learner'} studentId={selectedLearnerId} />
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
          </nav>

          <div className={styles.sidebarFooter}>
            <span>English · Yoruba voice ready</span>
            <span>Counsellor sign-off active</span>
          </div>
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
          </div>

          <div className={styles.content}>
            <Routes>
              <Route index element={learningRole === 'loading' ? null : <Navigate to={defaultPathForRole(effectiveRole)} replace />} />
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
