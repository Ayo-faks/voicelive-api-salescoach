/**
 * Pathfinder learner "This week" stats hook.
 *
 * Fetches real per-learner weekly progress from
 * `GET /api/learning/weekly-stats` so the learner home card stops showing the
 * old hardcoded "4 / 5 · 7 days · +12 pts". The endpoint is flag-gated on
 * `pathfinder_learner_onboarding_enabled`; when the flag is OFF (demo/tests)
 * the hook stays idle and the caller keeps its static demo tiles.
 */
import { useEffect, useState } from 'react'

import { fetchWeeklyStats, type LearnerWeeklyStatsResponse } from '../api'
import { featureFlags } from '../../utils/featureFlags'

export type WeeklyStatsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UseWeeklyStatsResult {
  /** `idle` when the onboarding flag is off (keep static demo tiles). */
  status: WeeklyStatsStatus
  stats: LearnerWeeklyStatsResponse | null
}

/** Read the calling learner's real weekly stats. Returns `idle` (no fetch)
 * when the onboarding flag is off so flag-off demo builds and tests keep their
 * deterministic tiles. */
export function useWeeklyStats(
  studentId?: string | null,
  refreshKey = 0
): UseWeeklyStatsResult {
  const enabled = featureFlags.pathfinder_learner_onboarding_enabled
  const [status, setStatus] = useState<WeeklyStatsStatus>(
    enabled ? 'loading' : 'idle'
  )
  const [stats, setStats] = useState<LearnerWeeklyStatsResponse | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    let cancelled = false
    const requestVersion = refreshKey
    setStatus('loading')
    fetchWeeklyStats(studentId ? { student_id: studentId } : {})
      .then(result => {
        if (cancelled || requestVersion !== refreshKey) return
        setStats(result)
        setStatus('ready')
      })
      .catch(err => {
        if (cancelled || requestVersion !== refreshKey) return
        console.warn('weekly stats fetch failed', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [enabled, studentId, refreshKey])

  return { status, stats }
}
