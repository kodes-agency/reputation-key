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

/** The theme choice (Light, Dark, System) as one segmented control; the account menu uses `ThemeModeMenuControl`. */
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
