import { useThemeMode, type ThemeMode } from '#/components/hooks/use-theme-mode'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { THEME_MODE_OPTIONS } from './theme-mode-options'

type Props = Readonly<{
  /**
   * The id of a visible "Theme" label beside the control (the Preferences row).
   * Without one the control names itself "Theme".
   */
  labelledBy?: string
}>

/**
 * The theme choice: Light, Dark or System, as one segmented control. It is the
 * control for the setting wherever the setting is drawn in full: the
 * Preferences page here, and the account menu through `ThemeModeMenuControl`
 * (the same pill, drawn from menu items).
 */
export function ThemeModeControl({ labelledBy }: Props) {
  const { mode, setMode } = useThemeMode()
  const naming =
    labelledBy === undefined
      ? ({ 'aria-label': 'Theme' } as const)
      : ({ 'aria-labelledby': labelledBy } as const)
  return (
    <SegmentedControl
      {...naming}
      value={mode}
      onValueChange={(next) => setMode(next as ThemeMode)}
      options={THEME_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))}
    />
  )
}
