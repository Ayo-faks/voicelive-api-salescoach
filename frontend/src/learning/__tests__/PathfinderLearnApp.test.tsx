import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COOKIE_CONSENT_STORAGE_KEY,
  CookieConsentBanner,
  defaultPathForRole,
  navItemsForRole,
} from '../PathfinderLearnApp'

afterEach(() => {
  window.localStorage.clear()
})

describe('CookieConsentBanner', () => {
  it('renders when storage is empty', () => {
    render(<CookieConsentBanner />)

    expect(screen.getByTestId('cookie-consent-banner')).toBeTruthy()
  })

  it('writes the stable storage key and unmounts when accepted', () => {
    render(<CookieConsentBanner />)

    fireEvent.click(screen.getByTestId('cookie-consent-accept'))

    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe(
      'accepted'
    )
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('does not render when storage already has a choice', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'accepted')

    render(<CookieConsentBanner />)

    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })
})

describe('Pathfinder role routing helpers', () => {
  it('keeps parent and learner navigation scoped away from class/admin views', () => {
    const parentLabels = navItemsForRole('parent').map(item => item.label)
    const learnerLabels = navItemsForRole('learner').map(item => item.label)

    expect(parentLabels).toContain('Profile')
    expect(parentLabels).not.toContain('Teacher')
    expect(parentLabels).not.toContain('Trust & Safety')
    expect(learnerLabels).toContain('Learner')
    expect(learnerLabels).not.toContain('Library')
  })

  it('routes teachers to class dashboards and admins to governed oversight surfaces', () => {
    const teacherLabels = navItemsForRole('therapist').map(item => item.label)
    const adminLabels = navItemsForRole('admin').map(item => item.label)

    expect(defaultPathForRole('therapist')).toBe('/teacher')
    expect(defaultPathForRole('parent')).toBe('/profile')
    expect(teacherLabels).toEqual(['Teacher'])
    expect(adminLabels).toEqual(['Teacher', 'Library', 'Profile', 'Pathways', 'Trust & Safety'])
  })
})
