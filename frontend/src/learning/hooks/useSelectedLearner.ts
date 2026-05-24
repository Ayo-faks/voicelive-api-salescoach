import { useEffect, useState } from 'react'
import type { ChildProfile } from '../../types'

export const SELECTED_LEARNER_STORAGE_KEY = 'pathfinder.selectedLearnerId.v1'

export function resolveSelectedLearnerId(
  children: Pick<ChildProfile, 'id'>[],
  preferredId: string | null | undefined
): string | null {
  if (children.length === 0) return null
  if (preferredId && children.some(child => child.id === preferredId)) {
    return preferredId
  }
  return children[0]?.id ?? null
}

export function readStoredSelectedLearnerId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SELECTED_LEARNER_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeSelectedLearnerId(studentId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (studentId) {
      window.localStorage.setItem(SELECTED_LEARNER_STORAGE_KEY, studentId)
    } else {
      window.localStorage.removeItem(SELECTED_LEARNER_STORAGE_KEY)
    }
  } catch {
    // Selection still works for the current render when storage is blocked.
  }
}

export function useSelectedLearner(children: ChildProfile[]) {
  const [selectedLearnerId, setSelectedLearnerIdState] = useState<string | null>(() =>
    resolveSelectedLearnerId(children, readStoredSelectedLearnerId())
  )

  useEffect(() => {
    setSelectedLearnerIdState(current => {
      if (current && children.some(child => child.id === current)) return current
      return resolveSelectedLearnerId(children, readStoredSelectedLearnerId())
    })
  }, [children])

  function setSelectedLearnerId(studentId: string) {
    const resolved = resolveSelectedLearnerId(children, studentId)
    setSelectedLearnerIdState(resolved)
    storeSelectedLearnerId(resolved)
  }

  return { selectedLearnerId, setSelectedLearnerId }
}