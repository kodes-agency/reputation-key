import { Button } from '#/components/ui/button'
import { useThemeMode } from '#/components/hooks/use-theme-mode'
import { THEME_MODE_DETAILS, nextThemeMode, themeModeLabel } from './theme-mode-options'

/**
 * The public header's theme button: one icon that steps through the same list
 * the segmented `ThemeModeControl` shows (Light, Dark, System, in that order).
 * The header has no room for a three-segment control on a phone, so this is the
 * compact form of the same choice. It names the current mode and the one a click
 * switches to.
 */
export function ThemeToggle() {
  const { mode, setMode } = useThemeMode()
  const next = nextThemeMode(mode)
  const label = `Theme: ${themeModeLabel(mode)}. Switch to ${themeModeLabel(next)}.`
  const Icon = THEME_MODE_DETAILS[mode].icon

  return (
    // A plain Button with a `title`, not an IconButton: the public header is in the
    // first-paint closure, and the tooltip primitives are not (the bundle budget).
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={() => setMode(next)}
      aria-label={label}
      title={label}
    >
      <Icon />
    </Button>
  )
}
