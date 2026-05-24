import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COOKIE_CONSENT_STORAGE_KEY,
  CookieConsentBanner,
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
