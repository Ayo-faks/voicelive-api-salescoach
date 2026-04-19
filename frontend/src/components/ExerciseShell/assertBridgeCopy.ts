/*---------------------------------------------------------------------------------------------
 *  BRIDGE invariant: copy must be ≤ 7 whitespace-separated words.
 *  Dev: throw. Prod: warn + truncate. See plan §B.3 invariant (c).
 *--------------------------------------------------------------------------------------------*/

const MAX_BRIDGE_WORDS = 7

function defaultIsDev(): boolean {
  try {
    // Vite injects import.meta.env.DEV as boolean.
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
}

// Indirection so tests can override without touching import.meta.env.
export const __envHooks = {
  isDev: defaultIsDev,
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/**
 * Validate a BRIDGE beat string.
 * - Throws in dev when `text` exceeds {@link MAX_BRIDGE_WORDS} words.
 * - In prod logs a warning and returns the first 7 words joined by single spaces.
 * - Empty / whitespace-only input is allowed and returned unchanged; callers that
 *   require non-empty BRIDGE copy should enforce that separately.
 */
export function assertBridgeCopy(text: string): string {
  const words = tokenize(text)
  if (words.length <= MAX_BRIDGE_WORDS) {
    return text
  }
  const message =
    `assertBridgeCopy: BRIDGE copy must be ≤ ${MAX_BRIDGE_WORDS} words, got ${words.length}: "${text}"`
  if (__envHooks.isDev()) {
    throw new Error(message)
  }
  // Prod: log and truncate rather than breaking the session.
  console.warn(message)
  return words.slice(0, MAX_BRIDGE_WORDS).join(' ')
}

export const __test__ = { MAX_BRIDGE_WORDS, tokenize }
