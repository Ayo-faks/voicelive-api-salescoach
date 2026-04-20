/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PR12b mic-mode hybrid — shared frontend helpers.
 *
 * - Feature flag (`VITE_CONVERSATIONAL_MIC_ENABLED`) gates whether the
 *   Settings toggle is visible and whether conversational mode is reachable.
 * - Parent preference is persisted in `localStorage` under `wulo.micMode`.
 * - When the flag is off, `readStoredMicMode()` always returns `'tap'`,
 *   preserving the legacy push-to-talk behavior.
 *
 * The reducer that consumes this preference lives in `hooks/useMicMode.ts`;
 * this module intentionally stays free of React so it can be unit-tested
 * (and imported from the recorder/WS layers) without pulling the tree in.
 */

export type MicMode = 'conversational' | 'tap'

export const MIC_MODE_STORAGE_KEY = 'wulo.micMode'

const VALID_MODES: readonly MicMode[] = ['conversational', 'tap']

/** Read the Vite build-time feature flag. Treats anything other than the
 * literal string `"true"` as disabled (matches the pattern used elsewhere in
 * this codebase — see `dev/previewExport.ts`). */
export function isConversationalMicFlagEnabled(): boolean {
  try {
    return import.meta.env.VITE_CONVERSATIONAL_MIC_ENABLED === 'true'
  } catch {
    return false
  }
}

function isMicMode(value: unknown): value is MicMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
}

/**
 * Return the effective mic mode for the current session.
 *
 * Precedence:
 *   1. Explicit `override` (e.g. test harness).
 *   2. If the feature flag is off → always `'tap'` (no user-visible change).
 *   3. Value from `localStorage` when valid.
 *   4. Default `'conversational'` when the flag is on.
 */
export function readStoredMicMode(
  override?: MicMode,
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): MicMode {
  if (override && isMicMode(override)) return override
  if (!isConversationalMicFlagEnabled()) return 'tap'
  if (!storage) return 'conversational'
  try {
    const raw = storage.getItem(MIC_MODE_STORAGE_KEY)
    if (isMicMode(raw)) return raw
  } catch {
    // swallow — disabled storage (e.g. Safari private) falls back to default.
  }
  return 'conversational'
}

/** Persist the parent-facing toggle. No-op when storage is unavailable. */
export function writeStoredMicMode(
  mode: MicMode,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): void {
  if (!isMicMode(mode)) return
  if (!storage) return
  try {
    storage.setItem(MIC_MODE_STORAGE_KEY, mode)
  } catch {
    // swallow — storage quotas / private mode are non-fatal.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
