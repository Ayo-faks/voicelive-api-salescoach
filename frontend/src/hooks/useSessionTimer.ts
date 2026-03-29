import { useEffect } from 'react'

interface UseSessionTimerOptions {
  active: boolean
  activityKey: number
  recording: boolean
  onNudge: () => void
  onAutoEnd: () => void
  nudgeAfterMs?: number
  endAfterMs?: number
}

export function useSessionTimer({
  active,
  activityKey,
  recording,
  onNudge,
  onAutoEnd,
  nudgeAfterMs = 20_000,
  endAfterMs = 45_000,
}: UseSessionTimerOptions) {
  useEffect(() => {
    void activityKey

    if (!active || recording) {
      return
    }

    const nudgeTimer = window.setTimeout(() => {
      onNudge()
    }, nudgeAfterMs)

    const endTimer = window.setTimeout(() => {
      onAutoEnd()
    }, endAfterMs)

    return () => {
      window.clearTimeout(nudgeTimer)
      window.clearTimeout(endTimer)
    }
  }, [
    active,
    activityKey,
    endAfterMs,
    nudgeAfterMs,
    onAutoEnd,
    onNudge,
    recording,
  ])
}