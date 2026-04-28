// Property context — row ↔ domain mapper tests
// Verifies propertyFromRow and propertyToRow round-trip correctly,
// including nullable fields (gbpPlaceId, deletedAt) and branded ID casts.

import { describe, it, expect } from 'vitest'
import { propertyFromRow, propertyToRow } from './property.mapper'
import type { Property } from '../../domain/types'
import { organizationId, propertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makePropertyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  organizationId: 'org-1',
  name: 'Sunset Apartments',
  slug: 'sunset-apartments',
  timezone: 'America/Los_Angeles',
  gbpPlaceId: 'ChIJ123',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

const makeProperty = (overrides: Partial<Property> = {}): Property => ({
  id: propertyId('prop-1'),
  organizationId: organizationId('org-1'),
  name: 'Sunset Apartments',
  slug: 'sunset-apartments',
  timezone: 'America/Los_Angeles',
  gbpPlaceId: 'ChIJ123',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

describe('propertyFromRow', () => {
  it('maps all fields from row to domain', () => {
    // Arrange
    const row = makePropertyRow()

    // Act
    const property = propertyFromRow(row)

    // Assert
    expect(property.id).toBe('prop-1')
    expect(property.organizationId).toBe('org-1')
    expect(property.name).toBe('Sunset Apartments')
    expect(property.slug).toBe('sunset-apartments')
    expect(property.timezone).toBe('America/Los_Angeles')
    expect(property.gbpPlaceId).toBe('ChIJ123')
    expect(property.createdAt).toBe(FIXED_TIME)
    expect(property.updatedAt).toBe(FIXED_TIME)
    expect(property.deletedAt).toBeNull()
  })

  it('maps null gbpPlaceId correctly', () => {
    // Arrange
    const row = makePropertyRow({ gbpPlaceId: null })

    // Act
    const property = propertyFromRow(row)

    // Assert
    expect(property.gbpPlaceId).toBeNull()
  })

  it('maps deletedAt date when present', () => {
    // Arrange
    const deletedAt = new Date('2026-05-01T00:00:00Z')
    const row = makePropertyRow({ deletedAt })

    // Act
    const property = propertyFromRow(row)

    // Assert
    expect(property.deletedAt).toEqual(deletedAt)
  })
})

describe('propertyToRow', () => {
  it('maps all fields from domain to row', () => {
    // Arrange
    const property = makeProperty()

    // Act
    const row = propertyToRow(property)

    // Assert
    expect(row.id).toBe('prop-1')
    expect(row.organizationId).toBe('org-1')
    expect(row.name).toBe('Sunset Apartments')
    expect(row.slug).toBe('sunset-apartments')
    expect(row.timezone).toBe('America/Los_Angeles')
    expect(row.gbpPlaceId).toBe('ChIJ123')
    expect(row.createdAt).toBe(FIXED_TIME)
    expect(row.updatedAt).toBe(FIXED_TIME)
    expect(row.deletedAt).toBeNull()
  })

  it('maps null gbpPlaceId to row', () => {
    // Arrange
    const property = makeProperty({ gbpPlaceId: null })

    // Act
    const row = propertyToRow(property)

    // Assert
    expect(row.gbpPlaceId).toBeNull()
  })
})

describe('round-trip: propertyToRow → propertyFromRow', () => {
  it('preserves all fields through a round-trip', () => {
    // Arrange
    const original = makeProperty()

    // Act
    const row = propertyToRow(original)
    const restored = propertyFromRow(row as ReturnType<typeof makePropertyRow>)

    // Assert
    expect(restored.id).toBe(original.id)
    expect(restored.organizationId).toBe(original.organizationId)
    expect(restored.name).toBe(original.name)
    expect(restored.slug).toBe(original.slug)
    expect(restored.timezone).toBe(original.timezone)
    expect(restored.gbpPlaceId).toBe(original.gbpPlaceId)
    expect(restored.createdAt).toBe(original.createdAt)
    expect(restored.updatedAt).toBe(original.updatedAt)
    expect(restored.deletedAt).toBe(original.deletedAt)
  })
})
