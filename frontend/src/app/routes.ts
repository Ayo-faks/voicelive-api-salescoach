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
  privacy: '/privacy',
  terms: '/terms',
  aiTransparency: '/ai-transparency',
} as const

export const APP_ROUTE_PARAMS = {
  childId: 'childId',
  scenarioId: 'scenarioId',
  sessionId: 'sessionId',
  planId: 'planId',
  invitationId: 'invitationId',
} as const

export type AppRoute = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]

type DefaultRouteArgs = {
  onboardingComplete: boolean
  role: 'therapist' | 'parent' | 'admin' | 'pending_therapist' | null
}

const KNOWN_ROUTES = new Set<AppRoute>(Object.values(APP_ROUTES))

export function resolveAppRoute(pathname: string): AppRoute | null {
  return KNOWN_ROUTES.has(pathname as AppRoute) ? (pathname as AppRoute) : null
}

export function getDefaultAuthenticatedRoute({
  onboardingComplete,
  role,
}: DefaultRouteArgs): AppRoute {
  const requiresOnboarding = role === 'therapist' || role === 'admin'

  if (requiresOnboarding && !onboardingComplete) {
    return APP_ROUTES.onboarding
  }

  return APP_ROUTES.home
}