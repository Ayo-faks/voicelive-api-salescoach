import { registerAppInsightsSink, type TelemetryProperties } from './telemetry'

let bootstrapPromise: Promise<void> | null = null
let bootstrappedConnectionString: string | null = null

function sanitizeProperties(
  properties?: TelemetryProperties
): Record<string, string | number | boolean> | undefined {
  if (!properties) {
    return undefined
  }

  const entries = Object.entries(properties).filter(([, value]) => value !== null && value !== undefined)
  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries) as Record<string, string | number | boolean>
}

export async function bootstrapAppInsights(connectionString: string): Promise<void> {
  const normalized = connectionString.trim()
  if (!normalized) {
    return
  }

  if (bootstrappedConnectionString === normalized && bootstrapPromise) {
    return bootstrapPromise
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = import('@microsoft/applicationinsights-web')
    .then(({ ApplicationInsights }) => {
      const appInsights = new ApplicationInsights({
        config: {
          connectionString: normalized,
          disableAjaxTracking: true,
          disableCorrelationHeaders: true,
          disableExceptionTracking: true,
          disableFetchTracking: true,
          enableAutoRouteTracking: false,
        },
      })

      appInsights.loadAppInsights()
      registerAppInsightsSink((name, properties) => {
        appInsights.trackEvent({ name }, sanitizeProperties(properties))
      })
      bootstrappedConnectionString = normalized
    })
    .catch(error => {
      bootstrapPromise = null
      if (import.meta.env?.DEV) {
        console.warn('Application Insights bootstrap failed', error)
      }
    })

  return bootstrapPromise
}