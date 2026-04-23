/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal telemetry shim.
 *
 * v2 plan designates Application Insights as the system of record for the
 * onboarding funnel. The SDK is not yet wired into the frontend, so this
 * shim gives callers a stable API today and a single place to swap in the
 * real SDK later (docs/onboarding/onboarding-plan-v2.md — Tier A #6).
 *
 * Hard rule: child persona emits **nothing**. Enforce that at this layer
 * so consumers can't accidentally leak.
 */

export interface TelemetryProperties {
  [key: string]: string | number | boolean | null | undefined
}

interface TelemetryService {
  enabled: boolean
  disableForChild(): void
  trackEvent(name: string, properties?: TelemetryProperties): void
}

let _childMode = false
let _appInsightsTrack: ((name: string, props?: TelemetryProperties) => void) | null = null

export const telemetry: TelemetryService = {
  get enabled() {
    return !_childMode
  },

  disableForChild(): void {
    _childMode = true
  },

  trackEvent(name: string, properties?: TelemetryProperties): void {
    if (_childMode) return
    if (_appInsightsTrack) {
      _appInsightsTrack(name, properties)
      return
    }
    // Fallback: dev-only console breadcrumb. Safe in production (no-op if
    // consumers haven't wired a real sink yet).
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[telemetry]', name, properties ?? {})
    }
  },
}

/** Register a real AI tracker once it's bootstrapped. */
export function registerAppInsightsSink(
  track: (name: string, props?: TelemetryProperties) => void
): void {
  _appInsightsTrack = track
}
