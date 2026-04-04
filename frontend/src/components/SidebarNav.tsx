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
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  HomeIcon,
  RectangleGroupIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import type { ChildProfile } from '../types'

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
    position: 'sticky',
    top: 0,
    transition: 'width var(--transition-normal), min-width var(--transition-normal), padding var(--transition-normal), transform var(--transition-normal)',
    '@media (max-width: 720px)': {
      position: 'fixed',
      top: 0,
      left: 0,
      bottom: 0,
      minHeight: '100dvh',
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
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  },
  brandTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '800',
    letterSpacing: '-0.03em',
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
})

type SidebarSection = 'home' | 'dashboard' | 'settings'

interface SidebarNavProps {
  appTitle: string
  activeSection: SidebarSection
  collapsed: boolean
  mobileOpen: boolean
  isTherapist: boolean
  showDashboardNav: boolean
  childProfiles: ChildProfile[]
  childrenLoading: boolean
  selectedChildId: string | null
  selectedChild: ChildProfile | null
  showTherapistAccess: boolean
  onBrandClick: () => void
  onNavigateHome: () => void
  onNavigateDashboard: () => void
  onNavigateSettings: () => void
  onSelectChild: (childId: string) => void
  onToggleCollapse: () => void
  onCloseMobile: () => void
  onOpenTherapistAccess: () => void
}

export function SidebarNav({
  appTitle,
  activeSection,
  collapsed,
  mobileOpen,
  isTherapist,
  showDashboardNav,
  childProfiles,
  childrenLoading,
  selectedChildId,
  selectedChild,
  showTherapistAccess,
  onBrandClick,
  onNavigateHome,
  onNavigateDashboard,
  onNavigateSettings,
  onSelectChild,
  onToggleCollapse,
  onCloseMobile,
  onOpenTherapistAccess,
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
              {isExpanded ? 'Dashboard' : ''}
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
              {isExpanded ? 'Workspace' : ''}
            </Button>
          </nav>

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
          {showTherapistAccess && isExpanded ? (
            <Button appearance="subtle" className={styles.footerButton} onClick={onOpenTherapistAccess}>
              Therapist access
            </Button>
          ) : null}

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