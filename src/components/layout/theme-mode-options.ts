// The theme choices, listed once. Light, Dark, System is the order everywhere:
// the segmented control (Preferences, the account menu) draws them left to
// right in it, and the public header's compact button steps through it. The
// stored mode for "follow the device" is `auto`; people see it as System.

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import type { ThemeMode } from '#/components/hooks/use-theme-mode'

type ThemeModeDetails = Readonly<{ label: string; icon: LucideIcon }>

/** What each stored mode is called and drawn as. */
export const THEME_MODE_DETAILS: Readonly<Record<ThemeMode, ThemeModeDetails>> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  auto: { label: 'System', icon: Monitor },
}

const THEME_MODE_ORDER: ReadonlyArray<ThemeMode> = ['light', 'dark', 'auto']

export const THEME_MODE_OPTIONS: ReadonlyArray<
  Readonly<{ value: ThemeMode; label: string }>
> = THEME_MODE_ORDER.map((value) => ({
  value,
  label: THEME_MODE_DETAILS[value].label,
}))

export function themeModeLabel(mode: ThemeMode): string {
  return THEME_MODE_DETAILS[mode].label
}

/** The mode after this one, in list order, wrapping from System to Light. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODE_ORDER.indexOf(mode)
  return THEME_MODE_ORDER[(index + 1) % THEME_MODE_ORDER.length] ?? 'light'
}
