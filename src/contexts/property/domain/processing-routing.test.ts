// BQR-3.5 — processing region resolution from country.

import { describe, it, expect } from 'vitest'
import {
  resolvePropertyRouting,
  wouldChangeResolvedRegion,
  assertRegionResolved,
  isRegionProcessable,
  ROUTING_POLICY_VERSION,
} from './processing-routing'
import { isPropertyError } from './errors'

const NOW = new Date('2026-07-16T12:00:00Z')

describe('resolvePropertyRouting', () => {
  it('leaves region unresolved when country is null', () => {
    const routing = resolvePropertyRouting({
      countryCode: null,
      countrySource: 'organization_default',
      now: NOW,
    })
    expect(routing.countryCode).toBeNull()
    expect(routing.processingRegion).toBe('unresolved')
    expect(routing.processingRegionResolvedAt).toBeNull()
    expect(routing.routingPolicyVersion).toBe(ROUTING_POLICY_VERSION)
  })

  it('resolves US territory to us', () => {
    const routing = resolvePropertyRouting({
      countryCode: 'us',
      countrySource: 'google_address',
      now: NOW,
    })
    expect(routing.countryCode).toBe('US')
    expect(routing.processingRegion).toBe('us')
    expect(routing.processingRegionSource).toBe('country_default')
    expect(routing.countrySource).toBe('google_address')
    expect(routing.processingRegionResolvedAt).toBe(NOW)
  })

  it('resolves EEA/UK/CH to europe', () => {
    expect(
      resolvePropertyRouting({
        countryCode: 'DE',
        countrySource: 'manual',
        now: NOW,
      }).processingRegion,
    ).toBe('europe')
    expect(
      resolvePropertyRouting({
        countryCode: 'GB',
        countrySource: 'manual',
        now: NOW,
      }).processingRegion,
    ).toBe('europe')
  })

  it('resolves other countries to global', () => {
    const routing = resolvePropertyRouting({
      countryCode: 'JP',
      countrySource: 'manual',
      now: NOW,
    })
    expect(routing.processingRegion).toBe('global')
  })
})

describe('wouldChangeResolvedRegion', () => {
  it('is false when current region is unresolved', () => {
    expect(wouldChangeResolvedRegion('unresolved', 'DE')).toBe(false)
    expect(wouldChangeResolvedRegion(null, 'DE')).toBe(false)
  })

  it('is false when new country maps to the same region', () => {
    expect(wouldChangeResolvedRegion('us', 'PR')).toBe(false)
    expect(wouldChangeResolvedRegion('europe', 'FR')).toBe(false)
  })

  it('is true when new country would change a resolved region', () => {
    expect(wouldChangeResolvedRegion('us', 'DE')).toBe(true)
    expect(wouldChangeResolvedRegion('europe', 'US')).toBe(true)
    expect(wouldChangeResolvedRegion('global', 'US')).toBe(true)
  })
})

// BQC-4.1 / ADR 0048: only the US cell executes protected workloads in beta.
// 'europe' is denied until its infrastructure passes; 'global' is a denied
// placeholder; 'unresolved' fails closed.
describe('isRegionProcessable', () => {
  it('is true only for us', () => {
    expect(isRegionProcessable('us')).toBe(true)
  })

  it('is false for denied or unresolved regions', () => {
    expect(isRegionProcessable('europe')).toBe(false)
    expect(isRegionProcessable('global')).toBe(false)
    expect(isRegionProcessable('unresolved')).toBe(false)
    expect(isRegionProcessable(null)).toBe(false)
  })
})

describe('assertRegionResolved', () => {
  it('does not throw for the approved us cell', () => {
    expect(() => assertRegionResolved({ processingRegion: 'us' })).not.toThrow()
  })

  it.each(['unresolved', 'europe', 'global'])(
    'throws region_unresolved for %s',
    (region) => {
      try {
        assertRegionResolved({ processingRegion: region })
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(isPropertyError(e)).toBe(true)
        expect((e as { code: string }).code).toBe('region_unresolved')
        expect((e as { context?: { processingRegion?: string } }).context).toEqual({
          processingRegion: region,
        })
      }
    },
  )

  it('throws region_unresolved when the region is missing (null)', () => {
    try {
      assertRegionResolved({ processingRegion: null })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(isPropertyError(e)).toBe(true)
      expect((e as { code: string }).code).toBe('region_unresolved')
    }
  })
})
