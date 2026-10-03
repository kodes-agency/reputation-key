import { useThemeMode, type ThemeMode } from '#/components/hooks/use-theme-mode'
import {
  DropdownMenuLabel,
  DropdownMenuSegment,
  DropdownMenuSegmentedGroup,
} from '#/components/ui/dropdown-menu'
import { THEME_MODE_OPTIONS } from './theme-mode-options'

const MENU_LABEL_ID = 'theme-mode-menu-label'

/**
 * The theme control inside the account menu: the same Light / Dark / System
 * pill as `ThemeModeControl`. A menu is not a place for a plain
 * radio group (Radix prevents Tab inside it, so the group could not be reached
 * from the keyboard), so the segments are menu radio items: arrow keys move
 * through them with the rest of the menu and Enter or Space chooses. Choosing
 * leaves the menu open so the change can be seen.
 */
export function ThemeModeMenuControl() {
  const { mode, setMode } = useThemeMode()
  return (
    <div className="px-2 pb-1.5">
      <DropdownMenuLabel id={MENU_LABEL_ID} className="px-0 pt-1 pb-1.5 text-xs">
        Theme
      </DropdownMenuLabel>
      <DropdownMenuSegmentedGroup
        aria-labelledby={MENU_LABEL_ID}
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
