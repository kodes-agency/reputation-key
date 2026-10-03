import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto'

/** `dark` when the document carries the dark class, else `light`. */
export function resolveAppliedTheme(
  classes: Readonly<{ contains: (name: string) => boolean }>,
): 'light' | 'dark' {
  return classes.contains('dark') ? 'dark' : 'light'
}

const THEME_STORAGE_KEY = 'theme'
const THEME_CHANGE_EVENT = 'rep-key:theme-change'
let volatileThemeMode: ThemeMode | null = null

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto'
}

function readThemeMode(): ThemeMode {
  if (volatileThemeMode !== null) return volatileThemeMode
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeMode(stored)) return stored
  } catch {
    // Keep the theme usable when storage is blocked.
  }
  return 'auto'
}

function subscribeToThemeMode(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
    volatileThemeMode = null
    onStoreChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
  }
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

function subscribeToAppliedTheme(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

/**
 * The theme the document is showing right now, `light` or `dark`, whatever mode
 * chose it (`auto` resolved against the OS, a stored choice, the first-paint
 * script, a Storybook decorator). Read it for a third-party widget that needs
 * its own `theme` prop; it applies nothing, unlike `useThemeMode`.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribeToAppliedTheme,
    () => resolveAppliedTheme(document.documentElement.classList),
    () => 'light',
  )
}

export function useThemeMode() {
  const mode = useSyncExternalStore<ThemeMode>(
    subscribeToThemeMode,
    readThemeMode,
    () => 'auto',
  )

  useEffect(() => {
    applyThemeMode(mode)
    if (mode !== 'auto') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  const setMode = useCallback((next: ThemeMode) => {
    volatileThemeMode = next
    applyThemeMode(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // The in-memory value remains active for this document.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }, [])

  return { mode, setMode } as const
}
