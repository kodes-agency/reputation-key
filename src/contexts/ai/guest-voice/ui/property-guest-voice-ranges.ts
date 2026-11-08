import {
  GUEST_VOICE_RANGES,
  RANGE_PRESET_LABELS,
  type GuestVoiceRange,
} from '#/shared/dashboard-range'

/** The control's words: the presets worded from the one table, and Automatic. */
export const GUEST_VOICE_RANGE_LABELS: Readonly<Record<GuestVoiceRange, string>> = {
  auto: 'Automatic',
  '30d': RANGE_PRESET_LABELS['30d'],
  '90d': RANGE_PRESET_LABELS['90d'],
  '180d': RANGE_PRESET_LABELS['180d'],
  '365d': RANGE_PRESET_LABELS['365d'],
  all: RANGE_PRESET_LABELS.all,
}

export const GUEST_VOICE_RANGE_OPTIONS: ReadonlyArray<{
  value: GuestVoiceRange
  label: string
}> = GUEST_VOICE_RANGES.map((value) => ({
  value,
  label: GUEST_VOICE_RANGE_LABELS[value],
}))

/**
 * Guest voice 2.0 reads its windows from the statistics engine, which has four: it has
 * no All time, so the control does not offer it.
 */
export const GUEST_VOICE_V2_RANGE_OPTIONS = GUEST_VOICE_RANGE_OPTIONS.filter(
  (option) => option.value !== 'all',
)
