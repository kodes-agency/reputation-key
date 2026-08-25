// Property context — row ↔ domain mapper tests
// Verifies propertyFromRow and propertyToRow round-trip correctly,
// including nullable provider-binding fields, deletion state, and branded ID casts.

import { describe, it, expect } from 'vitest'
import { propertyFromRow, propertyToRow } from './property.mapper'
import {
  DEFAULT_PROPERTY_GOOGLE_PROFILE,
  DEFAULT_PROPERTY_ROUTING,
  type Property,
} from '../../domain/types'
import { organizationId, propertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makePropertyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  organizationId: 'org-1',
  name: 'Sunset Apartments',
  slug: 'sunset-apartments',
  timezone: 'America/Los_Angeles',
  defaultReplyLanguage: null,
  googleConnectionId: null,
  address: null,
  gbpAccountId: null,
  gbpLocationId: 'ChIJ123',
  profileVersion: 1,
  googleBindingState: 'unbound',
  profileSource: 'legacy',
  profileConfirmedAt: null,
  profileConfirmedBy: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  lifecycleState: 'active',
  lifecycleReason: null,
  lifecycleStateChangedAt: null,
  purgeScheduledFor: null,
  lifecycleInitiatedBy: null,
  countryCode: null,
  countrySource: 'organization_default',
  timezoneSource: 'legacy',
  timezoneResolvedAt: null,
  processingRegion: 'unresolved',
  dataCellId: null,
  processingRegionSource: 'country_default',
  routingPolicyVersion: 1,
  processingRegionResolvedAt: null,
  sourceEpoch: 0,
  ...overrides,
})

const makeProperty = (overrides: Partial<Property> = {}): Property => ({
  id: propertyId('prop-1'),
  organizationId: organizationId('org-1'),
  name: 'Sunset Apartments',
  slug: 'sunset-apartments',
  timezone: 'America/Los_Angeles',
  defaultReplyLanguage: null,
  gbpLocationId: 'ChIJ123',
  googleConnectionId: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  lifecycleState: 'active',
  lifecycleReason: null,
  lifecycleStateChangedAt: null,
  purgeScheduledFor: null,
  lifecycleInitiatedBy: null,
  ...DEFAULT_PROPERTY_GOOGLE_PROFILE,
  ...DEFAULT_PROPERTY_ROUTING,
  ...overrides,
})

describe('propertyFromRow', () => {
  it('maps all fields from row to domain', () => {
    const row = makePropertyRow()
    const property = propertyFromRow(row)

    expect(property.id).toBe('prop-1')
    expect(property.organizationId).toBe('org-1')
    expect(property.name).toBe('Sunset Apartments')
    expect(property.slug).toBe('sunset-apartments')
    expect(property.timezone).toBe('America/Los_Angeles')
    expect(property.defaultReplyLanguage).toBeNull()
    expect(property.gbpLocationId).toBe('ChIJ123')
    expect(property.createdAt).toBe(FIXED_TIME)
    expect(property.updatedAt).toBe(FIXED_TIME)
    expect(property.deletedAt).toBeNull()
    expect(property.lifecycleState).toBe('active')
    expect(property.dataCellId).toBeNull()
  })

  it('maps a null canonical location ID correctly', () => {
    const row = makePropertyRow({ gbpLocationId: null })
    const property = propertyFromRow(row)

    expect(property.gbpLocationId).toBeNull()
  })

  it('maps a configured default reply language', () => {
    const property = propertyFromRow(
      makePropertyRow({ defaultReplyLanguage: 'bg-Cyrl-BG' }),
    )

    expect(property.defaultReplyLanguage).toBe('bg-Cyrl-BG')
  })

  it('maps deletedAt date when present', () => {
    const deletedAt = new Date('2026-05-01T00:00:00Z')
    const row = makePropertyRow({ deletedAt })
    const property = propertyFromRow(row)

    expect(property.deletedAt).toEqual(deletedAt)
  })

  it('maps lifecycle state from row', () => {
    const row = makePropertyRow({ lifecycleState: 'archived' })
    const property = propertyFromRow(row)

    expect(property.lifecycleState).toBe('archived')
  })

  it('reads a valid legacy region during the expand phase', () => {
    const property = propertyFromRow(
      makePropertyRow({ dataCellId: null, processingRegion: 'us' }),
    )

    expect(property.dataCellId).toBe('us')
  })

  it('fails closed on conflicting canonical and legacy assignments', () => {
    const property = propertyFromRow(
      makePropertyRow({ dataCellId: 'us', processingRegion: 'europe' }),
    )

    expect(property.dataCellId).toBeNull()
  })
})

describe('propertyToRow', () => {
  it('maps all fields from domain to row', () => {
    const property = makeProperty()
    const row = propertyToRow(property)

    expect(row.id).toBe('prop-1')
    expect(row.organizationId).toBe('org-1')
    expect(row.name).toBe('Sunset Apartments')
    expect(row.slug).toBe('sunset-apartments')
    expect(row.timezone).toBe('America/Los_Angeles')
    expect(row.defaultReplyLanguage).toBeNull()
    expect(row.gbpLocationId).toBe('ChIJ123')
    expect(row.lifecycleState).toBe('active')
    expect(row.dataCellId).toBeNull()
  })

  it('maps a null canonical location ID to both compatibility columns', () => {
    const property = makeProperty({ gbpLocationId: null })
    const row = propertyToRow(property)

    expect(row.gbpLocationId).toBeNull()
  })

  it('maps a configured default reply language to persistence', () => {
    const row = propertyToRow(makeProperty({ defaultReplyLanguage: 'tr-Latn-TR' }))

    expect(row.defaultReplyLanguage).toBe('tr-Latn-TR')
  })
})

describe('round-trip: propertyToRow → propertyFromRow', () => {
  it('preserves all fields through a round-trip', () => {
    const original = makeProperty()
    const row = propertyToRow(original)
    const restored = propertyFromRow(row as ReturnType<typeof makePropertyRow>)

    expect(restored.id).toBe(original.id)
    expect(restored.organizationId).toBe(original.organizationId)
    expect(restored.name).toBe(original.name)
    expect(restored.slug).toBe(original.slug)
    expect(restored.timezone).toBe(original.timezone)
    expect(restored.defaultReplyLanguage).toBe(original.defaultReplyLanguage)
    expect(restored.gbpLocationId).toBe(original.gbpLocationId)
    expect(restored.createdAt).toBe(original.createdAt)
    expect(restored.updatedAt).toBe(original.updatedAt)
    expect(restored.deletedAt).toBe(original.deletedAt)
    expect(restored.lifecycleState).toBe(original.lifecycleState)
    expect(restored.dataCellId).toBe(original.dataCellId)
  })
})
