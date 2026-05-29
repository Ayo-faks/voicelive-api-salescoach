import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TrustBadgeCluster,
  TRUST_BADGES,
  LEARNER_HOME_TRUST_BADGES,
} from './TrustBadgeCluster'
import { readEvents } from '../lib/telemetry'

function renderCluster(
  to?: string,
  variant?: React.ComponentProps<typeof TrustBadgeCluster>['variant']
) {
  return render(
    <MemoryRouter>
      <TrustBadgeCluster to={to} variant={variant} />
    </MemoryRouter>,
  )
}

describe('TrustBadgeCluster', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('renders three badges with titles and labels matching the spec', () => {
    renderCluster()
    for (const badge of TRUST_BADGES) {
      const el = screen.getByTitle(badge.title)
      expect(el.textContent).toContain(badge.label)
    }
  })

  it('exposes a labelled link to /trust by default', () => {
    renderCluster()
    const link = screen.getByTestId('learner-trust-badges')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/trust')
    expect(link.getAttribute('aria-label')).toBe('View trust and safety details')
  })

  it('trims the learner-home cluster to the evidence log badge only', () => {
    renderCluster(undefined, 'learner-home')
    const link = screen.getByTestId('learner-trust-badges')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/trust')
    expect(link.querySelectorAll('span').length).toBe(
      LEARNER_HOME_TRUST_BADGES.length
    )
    expect(link.textContent).toContain('Evidence log')
    expect(link.textContent).not.toContain('Teacher-reviewed')
    expect(link.textContent).not.toContain('Explainable')
  })

  it('honours a custom destination', () => {
    renderCluster('/safety')
    expect(screen.getByTestId('learner-trust-badges').getAttribute('href')).toBe('/safety')
  })

  it('logs a trust_badge_clicked telemetry event on click', () => {
    renderCluster(undefined, 'learner-home')
    fireEvent.click(screen.getByTestId('learner-trust-badges'))
    const events = readEvents()
    expect(events.some((e) => e.name === 'trust_badge_clicked')).toBe(true)
  })
})
