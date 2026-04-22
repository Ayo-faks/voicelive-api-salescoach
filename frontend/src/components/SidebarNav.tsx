/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Dropdown,
  Option,
  Text,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import {
  ArrowRightStartOnRectangleIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  HomeIcon,
  BookOpenIcon,
  RectangleGroupIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { APP_RELEASE_LABEL } from '../app/branding'
import type { ChildProfile, WorkspaceSummary } from '../types'

const useStyles = makeStyles({
  root: {
    position: 'relative',
    zIndex: 20,
    '@media (max-width: 720px)': {
      position: 'static',
    },
  },
  backdrop: {
    display: 'none',
    '@media (max-width: 720px)': {
      position: 'fixed',
      inset: 0,
      display: 'block',
      backgroundColor: 'rgba(15, 42, 58, 0.28)',
      opacity: 0,
      pointerEvents: 'none',
      transition: 'opacity var(--transition-normal)',
    },
  },
  backdropOpen: {
    '@media (max-width: 720px)': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
  aside: {
    width: '260px',
    minWidth: '260px',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-lg)',
    padding: 'var(--space-lg)',
    borderRight: '1px solid var(--color-border)',
    background: 'linear-gradient(135deg, rgba(233, 245, 246, 0.98), rgba(224, 239, 241, 0.98))',
    backdropFilter: 'blur(16px)',
    minHeight: '100vh',
    maxHeight: '100vh',
    overflowY: 'auto',
    position: 'sticky',
    top: 0,
    transition: 'width var(--transition-normal), min-width var(--transition-normal), padding var(--transition-normal), transform var(--transition-normal)',
    '@media (max-width: 720px)': {
      position: 'fixed',
      top: 0,
      left: 0,
      bottom: 0,
      minHeight: '100dvh',
      maxHeight: '100dvh',
      transform: 'translateX(-100%)',
      boxShadow: 'none',
    },
  },
  asideCollapsed: {
    width: '68px',
    minWidth: '68px',
    paddingRight: '10px',
    paddingLeft: '10px',
  },
  asideMobileOpen: {
    '@media (max-width: 720px)': {
      transform: 'translateX(0)',
      width: '260px',
      minWidth: '260px',
      padding: 'var(--space-lg)',
    },
  },
  top: {
    display: 'grid',
    gap: 'var(--space-md)',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
  },
  brandButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    minWidth: 0,
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
  },
  brandLogo: {
    width: '40px',
    height: '40px',
    objectFit: 'contain',
    flexShrink: 0,
  },
  brandText: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  brandTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '800',
    letterSpacing: '-0.03em',
  },
  brandMeta: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.64rem',
    fontWeight: '700',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  collapsedHidden: {
    '@media (min-width: 721px)': {
      display: 'none',
    },
  },
  desktopOnly: {
    '@media (max-width: 720px)': {
      display: 'none',
    },
  },
  mobileOnly: {
    display: 'none',
    '@media (max-width: 720px)': {
      display: 'inline-flex',
    },
  },
  nav: {
    display: 'grid',
    gap: 'var(--space-xs)',
  },
  navButton: {
    justifyContent: 'flex-start',
    minHeight: '44px',
    paddingInline: '12px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--color-text-secondary)',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  navButtonCollapsed: {
    justifyContent: 'center',
    paddingInline: 0,
    minWidth: '44px',
  },
  navButtonActive: {
    border: '1px solid var(--color-border-strong)',
    backgroundColor: 'rgba(13, 138, 132, 0.06)',
    color: 'var(--color-text-primary)',
  },
  selectorCard: {
    display: 'grid',
    gap: 'var(--space-xs)',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
  },
  selectorLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  dropdown: {
    minWidth: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    border: '1px solid var(--color-border)',
  },
  footer: {
    marginTop: 'auto',
    display: 'grid',
    gap: 'var(--space-sm)',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
  },
  footerButton: {
    justifyContent: 'flex-start',
    minHeight: '40px',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: '8px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: '14px',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  userCardCollapsed: {
    justifyContent: 'center',
    padding: '8px',
  },
  userAvatar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(13, 138, 132, 0.9), rgba(73, 177, 171, 0.9))',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '700',
    fontFamily: 'var(--font-display)',
    flexShrink: 0,
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'var(--font-display)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userEmail: {
    fontSize: '10px',
    color: 'var(--color-text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})

type SidebarSection = 'home' | 'dashboard' | 'settings'

interface SidebarNavProps {
  appTitle: string
  activeSection: SidebarSection
  collapsed: boolean
  mobileOpen: boolean
  isTherapist: boolean
  showDashboardNav: boolean
  settingsLabel: string
  childProfiles: ChildProfile[]
  childrenLoading: boolean
  selectedChildId: string | null
  selectedChild: ChildProfile | null
  userWorkspaces: WorkspaceSummary[]
  activeWorkspaceId: string | null
  userName: string | null
  userEmail: string | null
  onSignOut: () => void
  onBrandClick: () => void
  onNavigateHome: () => void
  onNavigateDashboard: () => void
  onNavigateSettings: () => void
  onSelectChild: (childId: string) => void
  onSwitchWorkspace: (workspaceId: string) => void
  onToggleCollapse: () => void
  onCloseMobile: () => void
}

export function SidebarNav({
  appTitle,
  activeSection,
  collapsed,
  mobileOpen,
  isTherapist,
  showDashboardNav,
  settingsLabel,
  childProfiles,
  childrenLoading,
  selectedChildId,
  selectedChild,
  userWorkspaces,
  activeWorkspaceId,
  userName,
  userEmail,
  onSignOut,
  onBrandClick,
  onNavigateHome,
  onNavigateDashboard,
  onNavigateSettings,
  onSelectChild,
  onSwitchWorkspace,
  onToggleCollapse,
  onCloseMobile,
}: SidebarNavProps) {
  const styles = useStyles()
  const isExpanded = mobileOpen || !collapsed

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={mergeClasses(styles.backdrop, mobileOpen && styles.backdropOpen)}
        onClick={onCloseMobile}
        aria-label="Close navigation"
      />

      <aside
        className={mergeClasses(
          styles.aside,
          collapsed && styles.asideCollapsed,
          mobileOpen && styles.asideMobileOpen,
        )}
      >
        <div className={styles.top}>
          <div className={styles.brandRow}>
            <button type="button" className={styles.brandButton} onClick={onBrandClick}>
              <img src="/wulo-logo.png" alt="Wulo logo" className={styles.brandLogo} />
              <div className={mergeClasses(styles.brandText, !isExpanded && styles.collapsedHidden)}>
                <Text className={styles.brandTitle}>{appTitle}</Text>
                <Text className={styles.brandMeta}>{APP_RELEASE_LABEL}</Text>
              </div>
            </button>

            <Button
              appearance="subtle"
              icon={<XMarkIcon className="w-5 h-5" />}
              className={styles.mobileOnly}
              onClick={onCloseMobile}
              aria-label="Close navigation"
            />
          </div>

          <nav className={styles.nav} aria-label="Primary navigation">
            <Button
              appearance="subtle"
              icon={<HomeIcon className="w-5 h-5" />}
              className={mergeClasses(
                styles.navButton,
                !isExpanded && styles.navButtonCollapsed,
                activeSection === 'home' && styles.navButtonActive,
              )}
              onClick={onNavigateHome}
            >
              {isExpanded ? 'Home' : ''}
            </Button>
            <Button
              appearance="subtle"
              icon={<RectangleGroupIcon className="w-5 h-5" />}
              className={mergeClasses(
                styles.navButton,
                !isExpanded && styles.navButtonCollapsed,
                activeSection === 'dashboard' && styles.navButtonActive,
              )}
              onClick={onNavigateDashboard}
              style={{ display: showDashboardNav ? undefined : 'none' }}
            >
              {isExpanded ? 'Progress' : ''}
            </Button>
            <Button
              appearance="subtle"
              icon={<Cog6ToothIcon className="w-5 h-5" />}
              className={mergeClasses(
                styles.navButton,
                !isExpanded && styles.navButtonCollapsed,
                activeSection === 'settings' && styles.navButtonActive,
              )}
              onClick={onNavigateSettings}
            >
              {isExpanded ? settingsLabel : ''}
            </Button>
          </nav>

          {isExpanded && userWorkspaces.length > 1 ? (
            <div className={styles.selectorCard}>
              <Text className={styles.selectorLabel}>Workspace</Text>
              <Dropdown
                className={styles.dropdown}
                selectedOptions={activeWorkspaceId ? [activeWorkspaceId] : []}
                value={userWorkspaces.find(w => w.id === activeWorkspaceId)?.name || ''}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSwitchWorkspace(data.optionValue)
                  }
                }}
              >
                {userWorkspaces.map(workspace => (
                  <Option key={workspace.id} value={workspace.id} text={workspace.name}>
                    {workspace.name}
                  </Option>
                ))}
              </Dropdown>
            </div>
          ) : null}

          {isTherapist && isExpanded && activeSection === 'dashboard' ? (
            <div className={styles.selectorCard}>
              <Text className={styles.selectorLabel}>Active child</Text>
              <Dropdown
                className={styles.dropdown}
                disabled={childrenLoading || childProfiles.length === 0}
                placeholder={childrenLoading ? 'Loading child profiles...' : 'Select child'}
                selectedOptions={selectedChildId ? [selectedChildId] : []}
                value={selectedChild?.name}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectChild(data.optionValue)
                  }
                }}
              >
                {childProfiles.map(child => (
                  <Option key={child.id} value={child.id} text={child.name}>
                    {child.name}
                  </Option>
                ))}
              </Dropdown>
            </div>
          ) : null}
        </div>

        <div className={styles.footer}>
          {isTherapist && isExpanded ? (
            <Button
              appearance="subtle"
              className={styles.footerButton}
              icon={<BookOpenIcon className="w-5 h-5" />}
              as="a"
              href="https://www.wulo.ai/documentation#1-welcome-to-wulo"
              target="_blank"
              rel="noreferrer"
            >
              Therapist docs
            </Button>
          ) : null}

          {isExpanded ? (
            <>
              <Button appearance="subtle" className={styles.footerButton} as="a" href="/privacy">
                Privacy
              </Button>
              <Button appearance="subtle" className={styles.footerButton} as="a" href="/terms">
                Terms
              </Button>
              <Button appearance="subtle" className={styles.footerButton} as="a" href="/ai-transparency">
                AI notice
              </Button>

              <div className={styles.userCard}>
                <span className={styles.userAvatar}>
                  {(userName || '?').charAt(0).toUpperCase()}
                </span>
                <div className={styles.userInfo}>
                  <Text className={styles.userName}>{userName || 'User'}</Text>
                  {userEmail ? <Text className={styles.userEmail}>{userEmail}</Text> : null}
                </div>
                <Button
                  appearance="subtle"
                  icon={<ArrowRightStartOnRectangleIcon className="w-5 h-5" />}
                  onClick={onSignOut}
                  aria-label="Sign out"
                  title="Sign out"
                />
              </div>
            </>
          ) : (
            <div className={mergeClasses(styles.userCard, styles.userCardCollapsed)}>
              <Button
                appearance="subtle"
                icon={<ArrowRightStartOnRectangleIcon className="w-5 h-5" />}
                onClick={onSignOut}
                aria-label="Sign out"
                title="Sign out"
              />
            </div>
          )}

          <Button
            appearance="subtle"
            icon={
              collapsed ? (
                <ChevronDoubleRightIcon className="w-5 h-5" />
              ) : (
                <ChevronDoubleLeftIcon className="w-5 h-5" />
              )
            }
            className={mergeClasses(styles.footerButton, styles.desktopOnly)}
            onClick={onToggleCollapse}
          >
            {isExpanded ? 'Collapse sidebar' : ''}
          </Button>
        </div>
      </aside>
    </div>
  )
}