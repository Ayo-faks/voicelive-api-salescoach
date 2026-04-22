import { APP_ROUTES } from './routes'

type BackToPracticeRouteArgs = {
  connected: boolean
  showLaunchTransition: boolean
  hasCurrentAgent: boolean
  messageCount: number
}

export function getBackToPracticeRoute({
  connected,
  showLaunchTransition,
  hasCurrentAgent,
  messageCount,
}: BackToPracticeRouteArgs): (typeof APP_ROUTES)[keyof typeof APP_ROUTES] {
  return connected || showLaunchTransition || hasCurrentAgent || messageCount > 0
    ? APP_ROUTES.session
    : APP_ROUTES.home
}