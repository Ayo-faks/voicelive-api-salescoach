export const APP_ROUTES = {
  root: '/',
  login: '/login',
  logout: '/logout',
  onboarding: '/onboarding',
  mode: '/mode',
  home: '/home',
  dashboard: '/dashboard',
  settings: '/settings',
  session: '/session',
} as const

export const APP_ROUTE_PARAMS = {
  childId: 'childId',
  scenarioId: 'scenarioId',
  sessionId: 'sessionId',
  planId: 'planId',
} as const

export type AppRoute = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]

type DefaultRouteArgs = {
  onboardingComplete: boolean
  userMode: 'therapist' | 'child' | null
}

const KNOWN_ROUTES = new Set<AppRoute>(Object.values(APP_ROUTES))

export function resolveAppRoute(pathname: string): AppRoute | null {
  return KNOWN_ROUTES.has(pathname as AppRoute) ? (pathname as AppRoute) : null
}

export function getDefaultAuthenticatedRoute({
  onboardingComplete,
  userMode,
}: DefaultRouteArgs): AppRoute {
  if (!onboardingComplete) {
    return APP_ROUTES.onboarding
  }

  if (!userMode) {
    return APP_ROUTES.mode
  }

  return APP_ROUTES.home
}