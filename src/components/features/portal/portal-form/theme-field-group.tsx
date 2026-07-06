import { ThemePresetSelector } from '../portal-settings/theme-preset-selector'

type Props = Readonly<{
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
}>

export function ThemeFieldGroup({ primaryColor, onPrimaryColorChange }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Theme</h2>
      <ThemePresetSelector
        primaryColor={primaryColor}
        onPrimaryColorChange={onPrimaryColorChange}
      />
    </div>
  )
}
