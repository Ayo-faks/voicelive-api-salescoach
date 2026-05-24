import { useState } from 'react'
import { Button, Text, makeStyles } from '@fluentui/react-components'
import {
  AcademicCapIcon,
  BookOpenIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import PathwaysExplorer from './routes/PathwaysExplorer'
import SkillLibrary from './routes/SkillLibrary'
import StudentLearningHome from './routes/StudentLearningHome'
import StudentMasteryProfile from './routes/StudentMasteryProfile'
import TeacherMasteryDashboard from './routes/TeacherMasteryDashboard'
import TrustSafetyConsole from './routes/TrustSafetyConsole'
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
}

const navItems: NavItem[] = [
  { to: '/home', label: 'Learner', hint: 'Today', icon: AcademicCapIcon },
  { to: '/teacher', label: 'Teacher', hint: 'Class', icon: ChartBarIcon },
  { to: '/library', label: 'Library', hint: 'Skills', icon: BookOpenIcon },
  { to: '/profile', label: 'Profile', hint: 'Insights', icon: UserCircleIcon },
  { to: '/pathways', label: 'Pathways', hint: 'Explore', icon: MagnifyingGlassIcon },
  { to: '/safety', label: 'Trust & Safety', hint: 'Console', icon: ShieldCheckIcon },
]

const useStyles = makeStyles({
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
    padding: '8px 10px',
    borderRadius: '8px',
    textDecoration: 'none',
    color: t.brand.textSecondary,
    fontSize: '0.88rem',
    fontWeight: 500,
    transition: 'background-color .12s, color .12s',
    ':hover': {
      backgroundColor: t.brand.lineSoft,
      color: t.brand.text,
    },
  },
  navLinkActive: {
    backgroundColor: t.brand.ink,
    color: `${t.brand.onInk} !important`,
    ':hover': {
      backgroundColor: t.brand.inkSoft,
      color: `${t.brand.onInk} !important`,
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
    padding: '4px 2px',
    textDecoration: 'none',
    color: t.brand.textTertiary,
    fontSize: '0.65rem',
    fontWeight: 500,
    borderRadius: '8px',
  },
  bottomNavLinkActive: { color: t.brand.ink },
  bottomNavIcon: { width: '22px', height: '22px' },
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
        <Button appearance="secondary" onClick={() => dismiss('managed')}>
          Manage
        </Button>
        <Button
          appearance="primary"
          data-testid="cookie-consent-accept"
          onClick={() => dismiss('accepted')}
        >
          Accept
        </Button>
      </div>
    </section>
  )
}

export default function PathfinderLearnApp() {
  const styles = useStyles()

  const renderNavLinks = (extraClass?: string) =>
    navItems.map(item => {
      const Icon = item.icon
      return (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              extraClass ?? styles.navLink,
              isActive
                ? extraClass
                  ? styles.bottomNavLinkActive
                  : styles.navLinkActive
                : '',
            ]
              .filter(Boolean)
              .join(' ')
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
    <div className={styles.page} data-testid="pathfinder-learn-app">
      <aside className={styles.sidebar} aria-label="Pathfinder primary">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            Pf
          </span>
          <div className={styles.brandText}>
            <Text className={styles.brandTitle}>Pathfinder</Text>
            <Text className={styles.brandSubtitle}>Wulo · JSS2 pilot</Text>
          </div>
        </div>

        <div className={styles.navGroupLabel}>Workspaces</div>
        <nav aria-label="Pathfinder views" style={{ display: 'grid', gap: '2px' }}>
          {renderNavLinks()}
        </nav>

        <div className={styles.sidebarFooter}>
          <span>en-NG · offline-ready</span>
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
              <Text className={styles.brandSubtitle}>JSS2 pilot</Text>
            </div>
          </div>
        </div>

        <div className={styles.content}>
          <Routes>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<StudentLearningHome />} />
            <Route path="/teacher" element={<TeacherMasteryDashboard />} />
            <Route path="/library" element={<SkillLibrary />} />
            <Route path="/profile" element={<StudentMasteryProfile />} />
            <Route path="/pathways" element={<PathwaysExplorer />} />
            <Route path="/safety" element={<TrustSafetyConsole />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </div>

        <nav className={styles.bottomNav} aria-label="Pathfinder bottom nav">
          {renderNavLinks(styles.bottomNavLink)}
        </nav>
      </main>
      <CookieConsentBanner />
    </div>
  )
}
