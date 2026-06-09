import {
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { PathfinderThemeMode } from '../theme/pathfinder-tokens'

const PATHFINDER_THEME_STORAGE_KEY = 'pathfinder-theme'

export interface PathfinderThemeContextValue {
  mode: PathfinderThemeMode
  setMode: (mode: PathfinderThemeMode) => void
  toggle: () => void
}

const PathfinderThemeContext = createContext<PathfinderThemeContextValue | null>(
  null
)

function readStoredTheme(): PathfinderThemeMode | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(PATHFINDER_THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

export function PathfinderThemeProvider({
  children,
}: {
  children: ReactNode
}): ReactElement {
  const [mode, setMode] = useState<PathfinderThemeMode>(
    () => readStoredTheme() ?? 'light'
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(PATHFINDER_THEME_STORAGE_KEY, mode)
    } catch {
      // Theme still works for the current session when storage is blocked.
    }
  }, [mode])

  const value = useMemo<PathfinderThemeContextValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(current => (current === 'dark' ? 'light' : 'dark')),
    }),
    [mode]
  )

  return createElement(PathfinderThemeContext.Provider, { value }, children)
}

export function usePathfinderTheme(): PathfinderThemeContextValue {
  const value = useContext(PathfinderThemeContext)
  if (!value) {
    throw new Error(
      'usePathfinderTheme must be used within PathfinderThemeProvider'
    )
  }
  return value
}