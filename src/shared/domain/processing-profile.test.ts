// Tests for ProcessingProfile region resolution (PRE17B).

import { describe, it, expect } from 'vitest'
import { resolveRegion, checkProcessingAvailability } from './processing-profile'
import type { ProcessingProfile } from './processing-profile'
import { propertyId } from './ids'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from './data-cell-catalogue'

describe('resolveRegion', () => {
  it('routes US territories to us', () => {
    expect(resolveRegion('US')).toBe('us')
    expect(resolveRegion('PR')).toBe('us')
    expect(resolveRegion('GU')).toBe('us')
  })

  it('routes European supported countries to the one US beta cell', () => {
    expect(resolveRegion('DE')).toBe('us')
    expect(resolveRegion('FR')).toBe('us')
    expect(resolveRegion('GB')).toBe('us')
    expect(resolveRegion('CH')).toBe('us')
    expect(resolveRegion('IS')).toBe('us')
  })

  it('routes other supported countries to the one US beta cell', () => {
    expect(resolveRegion('JP')).toBe('us')
    expect(resolveRegion('BR')).toBe('us')
    expect(resolveRegion('AU')).toBe('us')
  })

  it('handles lowercase country codes', () => {
    expect(resolveRegion('us')).toBe('us')
    expect(resolveRegion('de')).toBe('us')
  })
})

describe('checkProcessingAvailability', () => {
  const baseProfile: ProcessingProfile = {
    propertyId: propertyId('prop-1'),
    countryCode: 'US',
    countrySource: 'google_address',
    timeZone: 'America/New_York',
    timezoneSource: 'google_time_zone_api',
    timezoneResolvedAt: new Date('2026-07-14'),
    processingRegion: 'us',
    processingRegionSource: 'country_default',
    routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    processingRegionResolvedAt: new Date('2026-07-14'),
  }

  it('returns available when profile is complete', () => {
    const result = checkProcessingAvailability(baseProfile)
    expect(result.available).toBe(true)
  })

  it('returns country_unresolved when countryCode is empty', () => {
    const result = checkProcessingAvailability({ ...baseProfile, countryCode: '' })
    expect(result.available).toBe(false)
    if (!result.available) expect(result.reason).toBe('country_unresolved')
  })

  it('returns timezone_unresolved when timezone is UTC', () => {
    const result = checkProcessingAvailability({ ...baseProfile, timeZone: 'UTC' })
    expect(result.available).toBe(false)
    if (!result.available) expect(result.reason).toBe('timezone_unresolved')
  })

  it('returns region_unsupported when region is unresolved', () => {
    const result = checkProcessingAvailability({
      ...baseProfile,
      processingRegion: 'unresolved',
    })
    expect(result.available).toBe(false)
    if (!result.available) expect(result.reason).toBe('region_unsupported')
  })

  it.each(['europe', 'global'] as const)(
    'returns region_unsupported when the known %s cell is dormant',
    (processingRegion) => {
      const result = checkProcessingAvailability({
        ...baseProfile,
        processingRegion,
      })

      expect(result.available).toBe(false)
      if (!result.available) expect(result.reason).toBe('region_unsupported')
    },
  )
})
