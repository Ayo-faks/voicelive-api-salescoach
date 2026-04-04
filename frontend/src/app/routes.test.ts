import { describe, expect, it } from 'vitest'
import { APP_ROUTES, getDefaultAuthenticatedRoute, resolveAppRoute } from './routes'

describe('route helpers', () => {
  it('resolves known app routes and rejects unknown paths', () => {
    expect(resolveAppRoute(APP_ROUTES.login)).toBe(APP_ROUTES.login)
    expect(resolveAppRoute(APP_ROUTES.home)).toBe(APP_ROUTES.home)
    expect(resolveAppRoute('/not-a-route')).toBeNull()
  })

  it('prioritizes onboarding and mode before workspace routes', () => {
    expect(
      getDefaultAuthenticatedRoute({
        onboardingComplete: false,
        userMode: null,
      })
    ).toBe(APP_ROUTES.onboarding)

    expect(
      getDefaultAuthenticatedRoute({
        onboardingComplete: true,
        userMode: null,
      })
    ).toBe(APP_ROUTES.mode)
  })

  it('defaults authenticated users into the home route', () => {
    expect(
      getDefaultAuthenticatedRoute({
        onboardingComplete: true,
        userMode: 'therapist',
      })
    ).toBe(APP_ROUTES.home)

    expect(
      getDefaultAuthenticatedRoute({
        onboardingComplete: true,
        userMode: 'child',
      })
    ).toBe(APP_ROUTES.home)
  })
})