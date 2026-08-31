import { Button } from '#/components/ui/button'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useThemeMode, type ThemeMode } from '#/components/hooks/use-theme-mode'

export function ThemeToggle() {
  const { mode, setMode } = useThemeMode()

  const modes: ThemeMode[] = ['light', 'dark', 'auto']

  function toggleMode() {
    const nextMode = modes[(modes.indexOf(mode) + 1) % modes.length]!
    setMode(nextMode)
  }

  const label =
    mode === 'auto'
      ? 'Theme mode: auto (system). Click to switch to light mode.'
      : `Theme mode: ${mode}. Click to switch mode.`

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={toggleMode}
      aria-label={label}
      title={label}
    >
      <Icon />
    </Button>
  )
}
