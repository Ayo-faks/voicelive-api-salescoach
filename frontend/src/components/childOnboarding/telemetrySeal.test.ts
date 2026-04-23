/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Phase 4 telemetry-seal regression guard.
 *
 * The contract (docs/onboarding/onboarding-plan-v2.md §GDPR / Children's
 * Code) is that no file under ``src/childOnboarding/*`` or
 * ``src/components/childOnboarding/*`` calls ``telemetry.trackEvent``
 * / ``telemetry.identify`` directly. The adult-side OnboardingRuntime
 * seals the shim via ``disableForChild()``, but this test enforces
 * the static contract so a careless copy-paste from an adult surface
 * is caught at build time, not on a pilot tablet.
 */

import { describe, expect, it } from 'vitest'

const modules = {
  ...(import.meta.glob('../../childOnboarding/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob('../childOnboarding/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
}

describe('child onboarding telemetry seal', () => {
  it('no source file imports or calls telemetry.trackEvent / identify', () => {
    const offenders: { file: string; match: string }[] = []
    for (const [file, body] of Object.entries(modules)) {
      if (/\.test\.(ts|tsx)$/.test(file)) continue
      const calls = body.match(/telemetry\.(trackEvent|identify)\s*\(/g)
      if (calls) offenders.push({ file, match: calls.join(', ') })
      if (/from\s+['"][^'"]*services\/telemetry['"]/.test(body)) {
        offenders.push({ file, match: 'imports services/telemetry' })
      }
    }
    expect(
      offenders,
      `telemetry leaked into child-mode files: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('scans at least one file from each child-onboarding root', () => {
    const keys = Object.keys(modules)
    // At minimum we must have picked up some files; the specific
    // prefixes vary by Vite's glob normalization.
    expect(keys.length).toBeGreaterThan(3)
    // Known sentinel files exist in both roots.
    expect(keys.some((k) => k.endsWith('childUiState.ts'))).toBe(true)
    expect(keys.some((k) => k.endsWith('ChildMascot.tsx'))).toBe(true)
  })
})
