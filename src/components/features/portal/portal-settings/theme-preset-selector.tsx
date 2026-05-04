import { useState } from 'react'
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from '#/components/ui/color-picker'
import { Sun, Moon, Palette } from 'lucide-react'
import { cn } from '#/lib/utils'

type ThemePreset = 'light' | 'dark' | 'brand' | 'custom'

type ThemePresetSelectorProps = Readonly<{
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
  disabled?: boolean
}>

const PRESETS: ReadonlyArray<{
  id: ThemePreset
  label: string
  icon: typeof Sun
  colors: { primaryColor: string; backgroundColor: string; textColor: string }
}> = [
  {
    id: 'light',
    label: 'Light',
    icon: Sun,
    colors: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: Moon,
    colors: { primaryColor: '#6366f1', backgroundColor: '#111827', textColor: '#f9fafb' },
  },
  {
    id: 'brand',
    label: 'Brand',
    icon: Palette,
    colors: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  },
]

export function ThemePresetSelector({
  primaryColor,
  onPrimaryColorChange,
  disabled = false,
}: ThemePresetSelectorProps) {
  const [activePreset, setActivePreset] = useState<ThemePreset>('light')
  const [customOpen, setCustomOpen] = useState(false)

  const handlePresetSelect = (preset: ThemePreset) => {
    setActivePreset(preset)
    if (preset !== 'custom') {
      setCustomOpen(false)
      const found = PRESETS.find((p) => p.id === preset)
      if (found) onPrimaryColorChange(found.colors.primaryColor)
    } else {
      setCustomOpen(true)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {PRESETS.map((preset) => {
          const Icon = preset.icon
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => handlePresetSelect(preset.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors',
                activePreset === preset.id
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:bg-muted',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className="size-4" />
              {preset.label}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePresetSelect('custom')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors',
            activePreset === 'custom'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border hover:bg-muted',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div
            className="size-4 rounded-full border"
            style={{ backgroundColor: primaryColor }}
          />
          Custom
        </button>
      </div>

      {customOpen && activePreset === 'custom' && (
        <ColorPicker
          value={primaryColor}
          onValueChange={onPrimaryColorChange}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <ColorPickerTrigger>
              <ColorPickerSwatch />
            </ColorPickerTrigger>
            <ColorPickerInput withoutAlpha />
          </div>
          <ColorPickerContent>
            <ColorPickerArea />
            <ColorPickerHueSlider />
            <div className="flex items-center gap-2">
              <ColorPickerInput withoutAlpha />
              <ColorPickerFormatSelect />
              <ColorPickerEyeDropper />
            </div>
          </ColorPickerContent>
        </ColorPicker>
      )}
    </div>
  )
}
