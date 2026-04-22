import { describe, expect, it } from 'vitest'
import { APP_ROUTES } from './routes'
import { getBackToPracticeRoute } from './dashboardRouteHelpers'

describe('getBackToPracticeRoute', () => {
  it('returns the session route when there is resumable practice state', () => {
    expect(
      getBackToPracticeRoute({
        connected: false,
        showLaunchTransition: false,
        hasCurrentAgent: false,
        messageCount: 1,
      })
    ).toBe(APP_ROUTES.session)

    expect(
      getBackToPracticeRoute({
        connected: true,
        showLaunchTransition: false,
        hasCurrentAgent: false,
        messageCount: 0,
      })
    ).toBe(APP_ROUTES.session)
  })

  it('returns the home route when there is no practice to resume', () => {
    expect(
      getBackToPracticeRoute({
        connected: false,
        showLaunchTransition: false,
        hasCurrentAgent: false,
        messageCount: 0,
      })
    ).toBe(APP_ROUTES.home)
  })
})