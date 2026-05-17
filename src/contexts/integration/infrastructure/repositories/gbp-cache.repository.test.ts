// Integration context — GBP cache repository integration tests
// GBP cache has FK to properties and NO organization_id column.
// Uses manual cleanup by property_id.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createGbpCacheRepository } from './gbp-cache.repository'
import { getDb } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'

const ORG_A = organizationId('org-cache-aaaaaa')
const PROP_A = propertyId(crypto.randomUUID())
const PROP_SLUG = 'cachep-' + (PROP_A as string).slice(0, 12)
const PORTAL_SLUG = 'cacheport-' + crypto.randomUUID().slice(0, 12)

let pool: Pool

function buildTestCacheEntry(overrides: Partial<GbpCacheEntry> = {}): GbpCacheEntry {
  return {
    id: crypto.randomUUID(),
    propertyId: PROP_A,
    gbpPlaceId: 'ChIJ-test-place-id',
    dataType: 'location' as GbpCacheDataType,
    payload: { name: 'Test Business' },
    googleAttribution: 'Google',
    fetchedAt: new Date('2026-05-01T12:00:00Z'),
    expiresAt: new Date('2027-12-31T23:59:59Z'),
    ...overrides,
  }
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })

  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Cache Test Org', 'cache-test-org-aaa', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A as string],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Cache Test Prop', $3, 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A as string, ORG_A as string, PROP_SLUG],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $3, 'Cache Test Portal', $4, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [crypto.randomUUID(), ORG_A as string, PROP_A as string, PORTAL_SLUG],
  )
})

beforeEach(async () => {
  await pool.query('DELETE FROM gbp_cache WHERE property_id = $1', [PROP_A as string])
})

afterAll(async () => {
  await pool.end()
})

describe('gbpCacheRepository (integration)', () => {
  describe('upsert and findByPropertyAndType', () => {
    it('inserts and retrieves a cache entry', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db)
      const entry = buildTestCacheEntry()

      await repo.upsert(entry)
      const found = await repo.findByPropertyAndType(PROP_A, 'location')

      expect(found).not.toBeNull()
      expect(found!.gbpPlaceId).toBe('ChIJ-test-place-id')
      expect(found!.dataType).toBe('location')
      expect(found!.payload).toEqual({ name: 'Test Business' })
      expect(found!.googleAttribution).toBe('Google')
    })

    it('updates on conflict (same propertyId + dataType)', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db)
      const entry = buildTestCacheEntry()
      await repo.upsert(entry)

      const updated = buildTestCacheEntry({
        gbpPlaceId: 'ChIJ-updated-place',
        payload: { name: 'Updated Business' },
      })
      await repo.upsert(updated)

      const found = await repo.findByPropertyAndType(PROP_A, 'location')
      expect(found!.gbpPlaceId).toBe('ChIJ-updated-place')
      expect(found!.payload).toEqual({ name: 'Updated Business' })
    })

    it('returns null when no entry exists for given type', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db)
      // 'location' is the only valid type now; no entry inserted in this scope
      expect(await repo.findByPropertyAndType(PROP_A, 'location')).toBeNull()
    })
  })

  describe('deleteByProperty', () => {
    it('deletes cache entries by property', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db)
      await repo.upsert(buildTestCacheEntry({ dataType: 'location' }))

      await repo.deleteByProperty(PROP_A, ORG_A as string)
      const found = await repo.findByPropertyAndType(PROP_A, 'location')
      expect(found).toBeNull()
    })
  })

  describe('deleteExpired', () => {
    it('deletes entries with past expiry', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db)
      await repo.upsert(
        buildTestCacheEntry({
          dataType: 'location',
          expiresAt: new Date('2020-01-01T00:00:00Z'),
        }),
      )

      const count = await repo.deleteExpired()
      expect(count).toBeGreaterThanOrEqual(1)

      const found = await repo.findByPropertyAndType(PROP_A, 'location')
      expect(found).toBeNull()
    })
  })
})
