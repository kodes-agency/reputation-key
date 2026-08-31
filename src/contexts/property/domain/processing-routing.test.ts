// BQR-3.5 — processing region resolution from country.

import { describe, it, expect } from 'vitest'
import {
  resolvePropertyRouting,
  wouldChangeResolvedRegion,
  assertRegionResolved,
  dataCellBlockedReason,
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
    expect(routing.dataCellId).toBeNull()
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
    expect(routing.dataCellId).toBe('us')
    expect(routing.processingRegionSource).toBe('country_default')
    expect(routing.countrySource).toBe('google_address')
    expect(routing.processingRegionResolvedAt).toBe(NOW)
  })

  it('routes European countries to the single US beta cell', () => {
    expect(
      resolvePropertyRouting({
        countryCode: 'DE',
        countrySource: 'manual',
        now: NOW,
      }).processingRegion,
    ).toBe('us')
    expect(
      resolvePropertyRouting({
        countryCode: 'GB',
        countrySource: 'manual',
        now: NOW,
      }).processingRegion,
    ).toBe('us')
  })

  it('routes the rest of the supported world to the single US beta cell', () => {
    const routing = resolvePropertyRouting({
      countryCode: 'JP',
      countrySource: 'manual',
      now: NOW,
    })
    expect(routing.processingRegion).toBe('us')
    expect(routing.dataCellId).toBe('us')
  })
})

describe('wouldChangeResolvedRegion', () => {
  it('is false when current region is unresolved', () => {
    expect(wouldChangeResolvedRegion('unresolved', 'DE')).toBe(false)
    expect(wouldChangeResolvedRegion(null, 'DE')).toBe(false)
  })

  it('is false when new country maps to the same region', () => {
    expect(wouldChangeResolvedRegion('us', 'PR')).toBe(false)
    expect(wouldChangeResolvedRegion('us', 'FR')).toBe(false)
    expect(wouldChangeResolvedRegion('us', 'JP')).toBe(false)
  })

  it('detects stale assignments to dormant future cells', () => {
    expect(wouldChangeResolvedRegion('europe', 'US')).toBe(true)
    expect(wouldChangeResolvedRegion('global', 'US')).toBe(true)
  })
})

// Cell identity and activation are separate: future cells remain readable
// historical identifiers but are neither allocation nor execution targets.
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

  it('keeps known dormant cells recognizable but non-executable', () => {
    expect(ROUTED_REGIONS).toEqual(new Set(['us', 'europe', 'global']))
    expect([...ROUTED_REGIONS].filter((region) => !isRegionProcessable(region))).toEqual([
      'europe',
      'global',
    ])
  })
})

describe('assertRegionResolved', () => {
  it('does not throw for the accepting US cell', () => {
    expect(() => assertRegionResolved({ dataCellId: 'us' })).not.toThrow()
  })

  it.each(['europe', 'global'])(
    'fails closed while the known %s cell is dormant',
    (region) => {
      expect(() => assertRegionResolved({ dataCellId: region })).toThrow(
        /accepting Data Cell/,
      )
    },
  )

  it('throws region_unresolved when the region is missing (null)', () => {
    try {
      assertRegionResolved({ dataCellId: null })
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
    'reports region_denied while the known %s cell is dormant',
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

describe('dataCellBlockedReason', () => {
  it('distinguishes unresolved legacy rows from invalid/conflicting rows', () => {
    expect(dataCellBlockedReason(null, 'unresolved')).toBe('region_unresolved')
    expect(dataCellBlockedReason(null, null)).toBe('region_unresolved')
    expect(dataCellBlockedReason(null, 'unsupported-cell')).toBe('region_denied')
    expect(dataCellBlockedReason('us', 'us')).toBeNull()
    expect(dataCellBlockedReason('europe', 'europe')).toBe('region_denied')
  })
})
