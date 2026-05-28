/**
 * Persistent learner setup (exam, class/year, subject) used by both the
 * learner home form and fullscreen practice. Lives in localStorage
 * so the voice overlay can pick up the latest selection without lifting
 * state up to the app root.
 */
import { useCallback, useEffect, useState } from 'react'

export interface LearnerSetup {
  exam: string
  year: string
  subject: string
  firstName: string
}

export const LEARNER_SETUP_STORAGE_KEY = 'pathfinder-learner-setup-v1'

export const DEFAULT_LEARNER_SETUP: LearnerSetup = {
  exam: 'WAEC',
  year: 'SSS2',
  subject: 'Mathematics',
  firstName: '',
}

function readStored(): LearnerSetup {
  if (typeof window === 'undefined') return DEFAULT_LEARNER_SETUP
  try {
    const raw = window.localStorage.getItem(LEARNER_SETUP_STORAGE_KEY)
    if (!raw) return DEFAULT_LEARNER_SETUP
    const parsed = JSON.parse(raw) as Partial<LearnerSetup> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_LEARNER_SETUP
    return {
      exam:
        typeof parsed.exam === 'string' && parsed.exam
          ? parsed.exam
          : DEFAULT_LEARNER_SETUP.exam,
      year:
        typeof parsed.year === 'string' && parsed.year
          ? parsed.year
          : DEFAULT_LEARNER_SETUP.year,
      subject:
        typeof parsed.subject === 'string' && parsed.subject
          ? parsed.subject
          : DEFAULT_LEARNER_SETUP.subject,
      firstName:
        typeof parsed.firstName === 'string'
          ? parsed.firstName
          : DEFAULT_LEARNER_SETUP.firstName,
    }
  } catch {
    return DEFAULT_LEARNER_SETUP
  }
}

function writeStored(setup: LearnerSetup): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      LEARNER_SETUP_STORAGE_KEY,
      JSON.stringify(setup)
    )
    window.dispatchEvent(
      new CustomEvent<LearnerSetup>('pathfinder-learner-setup-change', {
        detail: setup,
      })
    )
  } catch {
    // Swallow quota / private-mode errors — falling back to in-memory state.
  }
}

export function useLearnerSetup(): [
  LearnerSetup,
  (next: Partial<LearnerSetup>) => void,
] {
  const [setup, setSetup] = useState<LearnerSetup>(() => readStored())

  // Stay in sync if another tab or component writes the same key.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LEARNER_SETUP_STORAGE_KEY) return
      setSetup(readStored())
    }
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<LearnerSetup>).detail
      if (detail) setSetup(detail)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(
      'pathfinder-learner-setup-change',
      onCustom as EventListener
    )
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(
        'pathfinder-learner-setup-change',
        onCustom as EventListener
      )
    }
  }, [])

  const update = useCallback((next: Partial<LearnerSetup>) => {
    setSetup(prev => {
      const merged: LearnerSetup = { ...prev, ...next }
      writeStored(merged)
      return merged
    })
  }, [])

  return [setup, update]
}
