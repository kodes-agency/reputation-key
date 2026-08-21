import { ThemePresetSelector } from '../portal-settings/theme-preset-selector'
import type { PortalThemeDraft } from '../shared/types'

type Props = Readonly<{
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
  disabled?: boolean
}>

export function ThemeFieldGroup({ theme, onThemeChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Theme</h2>
      <ThemePresetSelector
        theme={theme}
        onThemeChange={onThemeChange}
        disabled={disabled}
      />
    </div>
  )
}
