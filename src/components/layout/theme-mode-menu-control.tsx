import { useId } from 'react'
import { useThemeMode, type ThemeMode } from '#/components/hooks/use-theme-mode'
import {
  DropdownMenuLabel,
  DropdownMenuSegment,
  DropdownMenuSegmentedGroup,
} from '#/components/ui/dropdown-menu'
import { THEME_MODE_OPTIONS } from './theme-mode-options'

/**
 * The theme control inside the account menu. Radix prevents Tab inside a menu, so a
 * plain radio group would be unreachable by keyboard; the segments are menu radio
 * items (arrows move, Enter or Space chooses). Choosing leaves the menu open.
 */
export function ThemeModeMenuControl() {
  const { mode, setMode } = useThemeMode()
  // Generated, so a second menu on the page cannot duplicate the label id.
  const labelId = useId()
  return (
    <div className="px-2 pb-1.5">
      <DropdownMenuLabel id={labelId} className="px-0 pt-1 pb-1.5 text-xs">
        Theme
      </DropdownMenuLabel>
      <DropdownMenuSegmentedGroup
        aria-labelledby={labelId}
        value={mode}
        onValueChange={(next) => setMode(next as ThemeMode)}
      >
        {THEME_MODE_OPTIONS.map(({ value, label }) => (
          <DropdownMenuSegment
            key={value}
            value={value}
            onSelect={(event) => event.preventDefault()}
          >
            {label}
          </DropdownMenuSegment>
        ))}
      </DropdownMenuSegmentedGroup>
    </div>
  )
}
