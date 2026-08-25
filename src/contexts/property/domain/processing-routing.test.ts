// BQR-3.5 — processing region resolution from country.

import { describe, it, expect } from 'vitest'
import {
  resolvePropertyRouting,
  wouldChangeResolvedRegion,
  assertRegionResolved,
  isRegionProcessable,
  regionBlockedReason,
  ROUTING_POLICY_VERSION,
} from './processing-routing'
import { isPropertyError } from './errors'
import { ROUTED_REGIONS } from '#/shared/routing/processing-router'
import { ALL_PROCESSING_REGIONS } from '#/shared/domain/processing-profile'

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

// Cell identity and activation are separate: a known provisioning cell is a
// valid allocation target but not yet executable.
describe('isRegionProcessable', () => {
  it('allows the existing accepting US cell', () => {
    expect(isRegionProcessable('us')).toBe(true)
  })

  it.each(['europe', 'global', 'unresolved', null])(
    'fails closed for the non-accepting or unresolved cell %s',
    (region) => {
      expect(isRegionProcessable(region)).toBe(false)
    },
  )
})

// The domain predicate and router both consume the authoritative catalogue.
// Only cells in `accepting` state are processable and dispatchable.
describe('processable regions vs routed regions (contract)', () => {
  it('every processable region has a routing target', () => {
    const unrouted = ALL_PROCESSING_REGIONS.filter(
      (region) => isRegionProcessable(region) && !ROUTED_REGIONS.has(region),
    )
    expect(unrouted).toEqual([])
  })

  it('keeps known provisioning cells routable but non-executable', () => {
    expect(ROUTED_REGIONS).toEqual(new Set(['us', 'europe', 'global']))
    expect([...ROUTED_REGIONS].filter((region) => !isRegionProcessable(region))).toEqual([
      'europe',
      'global',
    ])
  })
})

describe('assertRegionResolved', () => {
  it('does not throw for the accepting US cell', () => {
    expect(() => assertRegionResolved({ processingRegion: 'us' })).not.toThrow()
  })

  it.each(['europe', 'global'])(
    'fails closed while the known %s cell is provisioning',
    (region) => {
      expect(() => assertRegionResolved({ processingRegion: region })).toThrow()
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

// BQC-4.4: content-free machine reason surfaced on read paths (property
// detail DTO, operator diagnostic). Mirrors the ProcessingRouter's blocked
// reasons — 'unresolved'/missing vs denied cell/placeholder.
describe('regionBlockedReason', () => {
  it('is null for the accepting US cell', () => {
    expect(regionBlockedReason('us')).toBeNull()
  })

  it.each(['europe', 'global'])(
    'reports region_denied while the known %s cell is provisioning',
    (region) => {
      expect(regionBlockedReason(region)).toBe('region_denied')
    },
  )

  it('is region_unresolved for unresolved or missing regions', () => {
    expect(regionBlockedReason('unresolved')).toBe('region_unresolved')
    expect(regionBlockedReason(null)).toBe('region_unresolved')
  })

  it('is region_denied for unknown region values (fail closed)', () => {
    expect(regionBlockedReason('antarctica')).toBe('region_denied')
  })
})
