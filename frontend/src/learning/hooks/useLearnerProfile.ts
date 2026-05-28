/**
 * Pathfinder learner profile hook (slice 2). Reads the server-side learner
 * profile via `/api/learners/me/profile` and exposes a `LearnerSetup`-shaped
 * adapter so the rest of the learner home can swap from `useLearnerSetup`
 * without touching every reference.
 *
 * When the `pathfinder_learner_onboarding_enabled` flag is OFF, this hook
 * delegates to the legacy `useLearnerSetup` localStorage flow — keeping the
 * demo path identical until the flag flips on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  api,
  type ConsentInput,
  type LearnerProfile,
  type LearnerProfilePatch,
  type LearnerProfileResponse,
} from '../../services/api'
import { featureFlags } from '../../utils/featureFlags'
import {
  DEFAULT_LEARNER_SETUP,
  LEARNER_SETUP_STORAGE_KEY,
  useLearnerSetup,
  type LearnerSetup,
} from './useLearnerSetup'

export interface UseLearnerProfileResult {
  setup: LearnerSetup
  updateSetup: (next: Partial<LearnerSetup>) => void
  profile: LearnerProfile | null
  needsOnboarding: boolean
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  patch: (patch: LearnerProfilePatch) => Promise<LearnerProfileResponse>
  recordConsent: (input: ConsentInput) => Promise<LearnerProfileResponse>
}

/** Map a server profile into the legacy `LearnerSetup` shape used by the
 * learner home cards (hero pill, weak topic, career summary). */
export function profileToSetup(
  profile: LearnerProfile | null,
  fallback: LearnerSetup = DEFAULT_LEARNER_SETUP
): LearnerSetup {
  if (!profile) return fallback
  const firstName =
    typeof profile.display_name === 'string' ? profile.display_name : ''
  const exam =
    typeof profile.exam === 'string' && profile.exam
      ? profile.exam
      : fallback.exam
  const year =
    typeof profile.year_group === 'string' && profile.year_group
      ? profile.year_group
      : fallback.year
  const subjects = Array.isArray(profile.subjects) ? profile.subjects : []
  const subject =
    typeof subjects[0] === 'string' && subjects[0]
      ? subjects[0]
      : fallback.subject
  return { exam, year, subject, firstName }
}

/** Convert a `LearnerSetup` patch to a server profile patch. Exported for
 * the legacy-localStorage migration helper. */
export function setupToProfilePatch(setup: LearnerSetup): LearnerProfilePatch {
  const patch: LearnerProfilePatch = {}
  if (setup.firstName) patch.display_name = setup.firstName
  if (setup.exam) patch.exam = setup.exam
  if (setup.year) patch.year_group = setup.year
  if (setup.subject) patch.subjects = [setup.subject]
  return patch
}

/** Read the legacy `pathfinder-learner-setup-v1` localStorage key and return
 * the parsed setup, or `null` if missing/invalid. Pure helper — unit-testable
 * without React. */
export function readLegacySetup(
  storage: Pick<Storage, 'getItem'>
): LearnerSetup | null {
  try {
    const raw = storage.getItem(LEARNER_SETUP_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LearnerSetup> | null
    if (!parsed || typeof parsed !== 'object') return null
    return {
      exam: typeof parsed.exam === 'string' && parsed.exam ? parsed.exam : '',
      year: typeof parsed.year === 'string' && parsed.year ? parsed.year : '',
      subject:
        typeof parsed.subject === 'string' && parsed.subject
          ? parsed.subject
          : '',
      firstName: typeof parsed.firstName === 'string' ? parsed.firstName : '',
    }
  } catch {
    return null
  }
}

/** Drop the legacy key from storage. Separate from the read so callers can
 * defer the delete until the PATCH succeeds. */
export function clearLegacySetup(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(LEARNER_SETUP_STORAGE_KEY)
  } catch {
    // Swallow private-mode / quota errors — re-runs are idempotent.
  }
}

/** Try to migrate the legacy localStorage setup to the server. Returns the
 * server response on success. Only clears the legacy key after the PATCH
 * resolves so a failed migration can retry on next mount. */
export async function migrateLegacySetup(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  patchFn: (patch: LearnerProfilePatch) => Promise<LearnerProfileResponse>
): Promise<LearnerProfileResponse | null> {
  const legacy = readLegacySetup(storage)
  if (!legacy) return null
  const patch = setupToProfilePatch(legacy)
  if (Object.keys(patch).length === 0) {
    clearLegacySetup(storage)
    return null
  }
  const response = await patchFn(patch)
  clearLegacySetup(storage)
  return response
}

export function useLearnerProfile(): UseLearnerProfileResult {
  const flagEnabled = featureFlags.pathfinder_learner_onboarding_enabled
  const [legacySetup, legacyUpdate] = useLearnerSetup()
  const [profile, setProfile] = useState<LearnerProfile | null>(null)
  const [consentsLoaded, setConsentsLoaded] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [isLoading, setIsLoading] = useState(flagEnabled)
  const [error, setError] = useState<string | null>(null)
  const migrationDone = useRef(false)

  const applyResponse = useCallback((response: LearnerProfileResponse) => {
    setProfile(response.profile ?? null)
    setNeedsOnboarding(Boolean(response.needs_onboarding))
    setConsentsLoaded(true)
  }, [])

  const refresh = useCallback(async () => {
    if (!flagEnabled) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const response = await api.getLearnerProfile()
      if (response) applyResponse(response)
      else {
        // Backend returned 404 — flag is off server-side. Fall back silently.
        setProfile(null)
        setNeedsOnboarding(false)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load profile'
      if (message !== 'UNAUTHORIZED') setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [applyResponse, flagEnabled])

  const patch = useCallback(
    async (next: LearnerProfilePatch): Promise<LearnerProfileResponse> => {
      const response = await api.patchLearnerProfile(next)
      applyResponse(response)
      return response
    },
    [applyResponse]
  )

  const recordConsent = useCallback(
    async (input: ConsentInput): Promise<LearnerProfileResponse> => {
      const response = await api.recordConsent(input)
      applyResponse(response)
      return response
    },
    [applyResponse]
  )

  // Initial load + legacy migration.
  useEffect(() => {
    if (!flagEnabled) return
    let cancelled = false
    void (async () => {
      await refresh()
      if (cancelled || migrationDone.current) return
      migrationDone.current = true
      if (typeof window === 'undefined') return
      try {
        await migrateLegacySetup(window.localStorage, api.patchLearnerProfile)
        // Re-pull after migration so derived setup reflects the merged
        // server state (cheap — same endpoint).
        if (!cancelled) await refresh()
      } catch {
        // Migration failure is non-fatal; user can complete onboarding.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [flagEnabled, refresh])

  const setup: LearnerSetup =
    flagEnabled && profile ? profileToSetup(profile, legacySetup) : legacySetup

  const updateSetup = useCallback(
    (next: Partial<LearnerSetup>) => {
      legacyUpdate(next)
      if (flagEnabled && consentsLoaded) {
        const profilePatch = setupToProfilePatch({ ...setup, ...next })
        if (Object.keys(profilePatch).length > 0) {
          void patch(profilePatch).catch(() => {
            // Surfacing the error here would interrupt the demo flow —
            // legacy state is already saved, so swallow and rely on the
            // next refresh.
          })
        }
      }
    },
    [consentsLoaded, flagEnabled, legacyUpdate, patch, setup]
  )

  return {
    setup,
    updateSetup,
    profile,
    needsOnboarding,
    isLoading,
    error,
    refresh,
    patch,
    recordConsent,
  }
}
