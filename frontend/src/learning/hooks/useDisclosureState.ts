import { useCallback, useEffect, useState } from 'react'

const KEY_PREFIX = 'pathfinder-disclosure'

function storageKey(userId: string, section: string): string {
  return `${KEY_PREFIX}:${userId}:${section}`
}

export function useDisclosureState(
  userId: string,
  section: string,
  defaultOpen = false
): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState<boolean>(defaultOpen)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(storageKey(userId, section))
      if (raw === '1') setOpen(true)
      else if (raw === '0') setOpen(false)
    } catch {
      // Ignore read errors; fall back to default.
    }
  }, [userId, section])

  const update = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(
          storageKey(userId, section),
          next ? '1' : '0'
        )
      } catch {
        // Persistence is best-effort.
      }
    },
    [userId, section]
  )

  return [open, update]
}
