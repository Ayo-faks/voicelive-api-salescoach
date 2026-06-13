/**
 * Frontend feature flags. Read from ``import.meta.env`` so values can be
 * injected at build time without code changes. Keep this file tiny and
 * dependency-free — it is imported from both the preview UI and analytics.
 */

function _readBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback
  const value = String(raw).trim().toLowerCase()
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on')
    return true
  if (value === '0' || value === 'false' || value === 'no' || value === 'off')
    return false
  return fallback
}

export interface FeatureFlags {
  /**
   * When true, the TTS preview UI exposes the non-IPA strategies
   * (``pseudo`` spelling, ``anchor`` word). Default false so IPA wins
   * everywhere — staff can still unlock the strategies to compare.
   */
  tts_preview_strategies_unlocked: boolean
  /**
   * When true, learners with `needs_onboarding=true` are routed through the
   * 3-step onboarding wizard at `/welcome` (Pathfinder learner profile
   * onboarding, slice 2). Default false — clients fall back to the legacy
   * in-page `useLearnerSetup` exam picker.
   */
  pathfinder_learner_onboarding_enabled: boolean
  /**
   * When true, learners are routed to the post-onboarding goal-intake screen
   * (`/goals`) where they state a study goal by voice or text and get instant
   * "start here" recommendations. Default false — onboarding goes straight to
   * `/home`.
   */
  pathfinder_goal_intake_enabled: boolean
  /**
   * When true, the learner home (and parent dashboard) render a row of
   * intent chips beneath the greeting that deep-link into existing flows
   * (practice, plan, Ask Wulo). Default false — current home unchanged.
   */
  pathfinder_home_chips_enabled: boolean
  /**
   * When true, the weekly stat tiles upgrade to the
   * `{number} → {meaning} → {CTA}` actionable-card pattern. Default false —
   * current passive tiles unchanged.
   */
  pathfinder_actionable_stats_enabled: boolean
  /**
   * When true (and learner voice is available), the learner home shows a
   * first-class voice entry card above the stats grid. Default false.
   */
  pathfinder_voice_entry_card_enabled: boolean
  /**
   * When true, the Tutor and Ask Wulo surfaces merge into one
   * presentation-aware assistant: chrome is derived from the latest reply
   * block (tutor cards render a focused tutor view, prose/profile/plan render
   * the Ask drawer). Default false — the standalone tutor + ask entries stay.
   */
  pathfinder_unified_assistant_enabled: boolean
}

export const featureFlags: FeatureFlags = Object.freeze({
  tts_preview_strategies_unlocked: _readBool(
    import.meta.env.VITE_TTS_PREVIEW_STRATEGIES_UNLOCKED,
    false
  ),
  pathfinder_learner_onboarding_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED,
    false
  ),
  pathfinder_goal_intake_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_GOAL_INTAKE_ENABLED,
    false
  ),
  pathfinder_home_chips_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_HOME_CHIPS_ENABLED,
    false
  ),
  pathfinder_actionable_stats_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_ACTIONABLE_STATS_ENABLED,
    false
  ),
  pathfinder_voice_entry_card_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_VOICE_ENTRY_CARD_ENABLED,
    false
  ),
  pathfinder_unified_assistant_enabled: _readBool(
    import.meta.env.VITE_PATHFINDER_UNIFIED_ASSISTANT_ENABLED,
    false
  ),
})
