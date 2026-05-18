// Integration context — GBP cache mapper tests

import { describe, it, expect } from 'vitest'
import { gbpCacheFromRow, gbpCacheToUpsert } from './gbp-cache.mapper'
import type { gbpCache } from '#/shared/db/schema/gbp-cache.schema'

type GbpCacheRow = typeof gbpCache.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')
const expiresAt = new Date('2025-06-02T12:00:00Z')

const samplePayload = { name: 'Test Business', rating: 4.5 }

const sampleRow: GbpCacheRow = {
  id: 'cache-uuid-001',
  organizationId: 'org-uuid-001',
  propertyId: 'prop-uuid-001',
  gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  dataType: 'location',
  payload: samplePayload,
  googleAttribution: 'Attributed to Google',
  fetchedAt: now,
  expiresAt,
  updatedAt: now,
}

describe('gbpCacheFromRow', () => {
  it('brands propertyId correctly', () => {
    const entry = gbpCacheFromRow(sampleRow)
    expect(entry.propertyId).toBe(sampleRow.propertyId)
  })

  it('leaves id as plain string', () => {
    const entry = gbpCacheFromRow(sampleRow)
    expect(entry.id).toBe('cache-uuid-001')
  })

  it('maps all fields', () => {
    const entry = gbpCacheFromRow(sampleRow)
    expect(entry.gbpPlaceId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
    expect(entry.dataType).toBe('location')
    expect(entry.payload).toEqual(samplePayload)
    expect(entry.googleAttribution).toBe('Attributed to Google')
    expect(entry.fetchedAt).toBe(now)
    expect(entry.expiresAt).toBe(expiresAt)
  })

  it('handles null googleAttribution', () => {
    const row = { ...sampleRow, googleAttribution: null }
    const entry = gbpCacheFromRow(row)
    expect(entry.googleAttribution).toBeNull()
  })
})

describe('gbpCacheToUpsert', () => {
  it('round-trips through fromRow → toUpsert', () => {
    const entry = gbpCacheFromRow(sampleRow)
    const upsert = gbpCacheToUpsert(entry)

    expect(upsert.id).toBe(sampleRow.id)
    expect(upsert.organizationId).toBe(sampleRow.organizationId)
    expect(upsert.propertyId).toBe(sampleRow.propertyId)
    expect(upsert.gbpPlaceId).toBe(sampleRow.gbpPlaceId)
    expect(upsert.dataType).toBe(sampleRow.dataType)
    expect(upsert.payload).toEqual(sampleRow.payload)
    expect(upsert.googleAttribution).toBe(sampleRow.googleAttribution)
    expect(upsert.fetchedAt).toBe(sampleRow.fetchedAt)
    expect(upsert.expiresAt).toBe(sampleRow.expiresAt)
  })

  it('round-trips with null googleAttribution', () => {
    const row = { ...sampleRow, googleAttribution: null }
    const entry = gbpCacheFromRow(row)
    const upsert = gbpCacheToUpsert(entry)
    expect(upsert.googleAttribution).toBeNull()
  })
})
