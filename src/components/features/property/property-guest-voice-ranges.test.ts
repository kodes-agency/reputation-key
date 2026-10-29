import { describe, expect, it } from 'vitest'
import { GUEST_VOICE_RANGES } from '#/shared/dashboard-range'
import {
  GUEST_VOICE_RANGE_LABELS,
  GUEST_VOICE_RANGE_OPTIONS,
  GUEST_VOICE_V2_RANGE_OPTIONS,
} from './property-guest-voice-ranges'

describe('the Guest voice range control', () => {
  it('words every range from the one preset table, 12 months included', () => {
    expect(GUEST_VOICE_RANGE_LABELS).toEqual({
      auto: 'Automatic',
      '30d': '30 days',
      '90d': '90 days',
      '180d': '6 months',
      '365d': '12 months',
      all: 'All time',
    })
  })

  it('offers them in order of reach, automatic first', () => {
    expect(GUEST_VOICE_RANGE_OPTIONS.map((option) => option.value)).toEqual([
      ...GUEST_VOICE_RANGES,
    ])
    expect(GUEST_VOICE_RANGE_OPTIONS.map((option) => option.label)).toEqual([
      'Automatic',
      '30 days',
      '90 days',
      '6 months',
      '12 months',
      'All time',
    ])
  })

  it('offers Guest voice 2.0 the same, without All time, which its four windows do not reach', () => {
    expect(GUEST_VOICE_V2_RANGE_OPTIONS.map((option) => option.label)).toEqual([
      'Automatic',
      '30 days',
      '90 days',
      '6 months',
      '12 months',
    ])
  })
})
