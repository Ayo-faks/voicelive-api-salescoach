/**
 * Frontend feature flags. Read from ``import.meta.env`` so values can be
 * injected at build time without code changes. Keep this file tiny and
 * dependency-free — it is imported from both the preview UI and analytics.
 */

function _readBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback
  const value = String(raw).trim().toLowerCase()
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
  return fallback
}

export interface FeatureFlags {
  /**
   * When true, the TTS preview UI exposes the non-IPA strategies
   * (``pseudo`` spelling, ``anchor`` word). Default false so IPA wins
   * everywhere — staff can still unlock the strategies to compare.
   */
  tts_preview_strategies_unlocked: boolean
}

export const featureFlags: FeatureFlags = Object.freeze({
  tts_preview_strategies_unlocked: _readBool(
    import.meta.env.VITE_TTS_PREVIEW_STRATEGIES_UNLOCKED,
    false,
  ),
})
