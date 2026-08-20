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
import { Sun, Moon, Palette, Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { PortalThemeDraft } from '../shared/types'

type ThemePreset = 'light' | 'dark' | 'brand' | 'custom'

type ThemePresetSelectorProps = Readonly<{
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
  disabled?: boolean
}>

// Every preset carries a complete palette, and all three colours are
// transmitted (contract C4). Presets must stay mutually distinguishable by
// primaryColor alone — the active preset is identified from it below.
const PRESETS: ReadonlyArray<{
  id: Exclude<ThemePreset, 'custom'>
  label: string
  icon: typeof Sun
  colors: Required<PortalThemeDraft>
}> = [
  {
    id: 'light',
    label: 'Light',
    icon: Sun,
    colors: {
      primaryColor: '#6366f1',
      backgroundColor: '#ffffff',
      textColor: '#111827',
    },
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: Moon,
    colors: {
      primaryColor: '#a5b4fc',
      backgroundColor: '#111827',
      textColor: '#f9fafb',
    },
  },
  {
    id: 'brand',
    label: 'Brand',
    icon: Palette,
    colors: {
      primaryColor: '#b45309',
      backgroundColor: '#fffbeb',
      textColor: '#1c1917',
    },
  },
]

export function ThemePresetSelector({
  theme,
  onThemeChange,
  disabled = false,
}: ThemePresetSelectorProps) {
  // The active preset is DERIVED from the incoming theme, never held in state:
  // seeding it from a constant made a saved custom colour display as "Light",
  // so clicking the already-highlighted Light button silently destroyed it.
  // `customRequested` only latches the explicit move from a preset to custom.
  const [customRequested, setCustomRequested] = useState(false)
  // An absent backgroundColor/textColor still matches: portals saved before the
  // full palette was transmitted stored only a primary colour, and the guest
  // page falls back to the very values the matching preset declares.
  const matched =
    PRESETS.find(
      (preset) =>
        theme.primaryColor.toLowerCase() === preset.colors.primaryColor.toLowerCase() &&
        (theme.backgroundColor === undefined ||
          theme.backgroundColor.toLowerCase() ===
            preset.colors.backgroundColor.toLowerCase()) &&
        (theme.textColor === undefined ||
          theme.textColor.toLowerCase() === preset.colors.textColor.toLowerCase()),
    )?.id ?? null
  const activePreset: ThemePreset = customRequested ? 'custom' : (matched ?? 'custom')

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Theme preset" className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => {
          const Icon = preset.icon
          const active = activePreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                setCustomRequested(false)
                onThemeChange(preset.colors)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary/5 text-link'
                  : 'border-border hover:bg-muted',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <Icon className="size-4" />
              {preset.label}
              {active && <Check className="size-4" aria-hidden />}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={activePreset === 'custom'}
          aria-expanded={activePreset === 'custom'}
          onClick={() => setCustomRequested(true)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
            activePreset === 'custom'
              ? 'border-primary bg-primary/5 text-link'
              : 'border-border hover:bg-muted',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <div
            className="size-4 rounded-full border"
            style={{ backgroundColor: theme.primaryColor }}
          />
          Custom
          {activePreset === 'custom' && <Check className="size-4" aria-hidden />}
        </button>
      </div>

      {activePreset === 'custom' && (
        <ColorPicker
          value={theme.primaryColor}
          onValueChange={(primaryColor) => onThemeChange({ ...theme, primaryColor })}
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
