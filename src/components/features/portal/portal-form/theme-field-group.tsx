import { ThemePresetSelector } from '../portal-settings/theme-preset-selector'

type Props = Readonly<{
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
}>

export function ThemeFieldGroup({ primaryColor, onPrimaryColorChange }: Props) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Theme</h3>
      <ThemePresetSelector
        primaryColor={primaryColor}
        onPrimaryColorChange={onPrimaryColorChange}
      />
    </div>
  )
}
