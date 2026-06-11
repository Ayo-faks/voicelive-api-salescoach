// Persistence for a tutor exercise the learner closed partway through
// (PRD follow-up: "Pick up where you left off" resumes pending exercises).
// localStorage only — no backend round-trip; keyed per child so siblings on a
// shared device never see each other's exercises.

export type PendingExercise = {
  /** Question stem of the exercise card the learner left unfinished. */
  stem: string
  skillId: string | null
  cardId: string
  savedAt: string
}

const keyFor = (childId: string) => `pathfinder-pending-exercise:${childId}`

/** Markers older than this never resurface — a 2-week-old half-exercise must
 * not become the home's headline CTA. */
const EXPIRY_MS = 48 * 60 * 60 * 1000

export function savePendingExercise(
  childId: string,
  exercise: Omit<PendingExercise, 'savedAt'>
): void {
  try {
    window.localStorage.setItem(
      keyFor(childId),
      JSON.stringify({ ...exercise, savedAt: new Date().toISOString() })
    )
  } catch {
    // Best-effort: resume is a convenience, never a blocker.
  }
}

export function loadPendingExercise(childId: string): PendingExercise | null {
  try {
    const raw = window.localStorage.getItem(keyFor(childId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingExercise>
    if (typeof parsed.stem !== 'string' || typeof parsed.cardId !== 'string') {
      return null
    }
    const age =
      typeof parsed.savedAt === 'string'
        ? Date.now() - new Date(parsed.savedAt).getTime()
        : Number.NaN
    if (!Number.isFinite(age) || age < 0 || age > EXPIRY_MS) {
      clearPendingExercise(childId)
      return null
    }
    return {
      stem: parsed.stem,
      skillId: typeof parsed.skillId === 'string' ? parsed.skillId : null,
      cardId: parsed.cardId,
      savedAt: parsed.savedAt as string,
    }
  } catch {
    return null
  }
}

export function clearPendingExercise(childId: string): void {
  try {
    window.localStorage.removeItem(keyFor(childId))
  } catch {
    // Ignore — worst case the stale entry is overwritten next session.
  }
}
