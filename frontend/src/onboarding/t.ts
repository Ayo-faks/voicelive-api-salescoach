/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thin string-lookup wrapper for onboarding copy.
 *
 * Goal (per docs/onboarding/onboarding-plan-v2.md Tier A #5): centralise
 * user-facing onboarding strings so pilot copy edits and a later i18n pass
 * are a single-PR change. This is NOT a full ICU/MessageFormat runtime.
 *
 * Callers pass the key + an English fallback; the fallback always ships as
 * the runtime value today. A future pass can swap `_lookup` for a real
 * locale-aware loader without changing call sites.
 */

type CopyKey = string

const _lookup: Record<CopyKey, string> = {
  // Populated incrementally by phase. See tours.ts / helpContent.ts /
  // checklist.ts / announcements.ts for the stable keys.
}

export function t(key: CopyKey, defaultEnglish: string): string {
  const override = _lookup[key]
  return override && override.length > 0 ? override : defaultEnglish
}
