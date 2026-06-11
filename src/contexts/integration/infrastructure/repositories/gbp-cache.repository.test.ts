// Integration context — GBP cache repository integration tests
// GBP cache has organization_id column and unique constraint on (organization_id, property_id, data_type).
// Tenant isolation tests verify cross-org boundaries are enforced.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createGbpCacheRepository } from './gbp-cache.repository'
import { getDb } from '#/shared/db'
import {
  organizationId,
  propertyId,
  gbpCacheEntryId,
  googleConnectionId,
} from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'
import type { PropertyQueryPort } from '../../application/ports/property-query.port'
import { properties } from '#/shared/db/schema/property.schema'
import { and, eq } from 'drizzle-orm'

const ORG_A = organizationId('org-cache-aaaaaa')
const ORG_B = organizationId('org-cache-bbbbbb')
const PROP_A = propertyId(crypto.randomUUID())
const PROP_B = propertyId(crypto.randomUUID())
const PROP_SLUG_A = 'cachep-' + (PROP_A as string).slice(0, 12)
const PROP_SLUG_B = 'cachep-' + (PROP_B as string).slice(0, 12)
const PORTAL_SLUG_A = 'cacheport-' + crypto.randomUUID().slice(0, 12)
const PORTAL_SLUG_B = 'cacheport-' + crypto.randomUUID().slice(0, 12)
const CONNECTION_ID_A = googleConnectionId(crypto.randomUUID())
const CONNECTION_ID_B = googleConnectionId(crypto.randomUUID())

let pool: Pool

/** Test-only PropertyQueryPort that queries the DB directly. */
const testPropertyQuery = (db: ReturnType<typeof getDb>): PropertyQueryPort => ({
  belongsToOrg: async (propertyId, orgId) => {
    const rows = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1)
    return rows.length > 0
  },
  findIdsByGoogleConnection: async (connectionId, orgId) => {
    const rows = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.googleConnectionId, connectionId),
          eq(properties.organizationId, orgId),
        ),
      )
    return rows.map((r) => r.id)
  },
})

function buildTestCacheEntry(overrides: Partial<GbpCacheEntry> = {}): GbpCacheEntry {
  return {
    id: gbpCacheEntryId(crypto.randomUUID()),
    organizationId: ORG_A,
    propertyId: PROP_A,
    gbpPlaceId: 'ChIJ-test-place-id',
    dataType: 'location' as GbpCacheDataType,
    payload: { name: 'Test Business' },
    googleAttribution: 'Google',
    fetchedAt: new Date('2026-05-01T12:00:00Z'),
    expiresAt: new Date('2027-12-31T23:59:59Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

async function truncateAll(pool: Pool) {
  await pool.query('DELETE FROM gbp_cache WHERE property_id IN ($1, $2)', [
    PROP_A as string,
    PROP_B as string,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROP_A as string,
    PROP_B as string,
  ])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [
    ORG_A as string,
    ORG_B as string,
  ])
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })

  // Seed ORG_A with property and portal
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Cache Test Org A', 'cache-test-org-aaa', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A as string],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, google_connection_id, created_at, updated_at)
     VALUES ($1, $2, 'Cache Test Prop A', $3, 'UTC', $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A as string, ORG_A as string, PROP_SLUG_A, CONNECTION_ID_A],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $3, 'Cache Test Portal A', $4, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [crypto.randomUUID(), ORG_A as string, PROP_A as string, PORTAL_SLUG_A],
  )

  // Seed ORG_B with property and portal
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Cache Test Org B', 'cache-test-org-bbb', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_B as string],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, google_connection_id, created_at, updated_at)
     VALUES ($1, $2, 'Cache Test Prop B', $3, 'UTC', $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_B as string, ORG_B as string, PROP_SLUG_B, CONNECTION_ID_B],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $3, 'Cache Test Portal B', $4, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [crypto.randomUUID(), ORG_B as string, PROP_B as string, PORTAL_SLUG_B],
  )
})

beforeEach(async () => {
  await pool.query('DELETE FROM gbp_cache WHERE property_id IN ($1, $2)', [
    PROP_A as string,
    PROP_B as string,
  ])
})

afterAll(async () => {
  await truncateAll(pool)
  await pool.end()
})

describe('gbpCacheRepository (integration)', () => {
  describe('upsert and findByPropertyAndType', () => {
    it('inserts and retrieves a cache entry', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))
      const entry = buildTestCacheEntry()

      await repo.upsert(entry)
      const found = await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')

      expect(found).not.toBeNull()
      expect(found!.gbpPlaceId).toBe('ChIJ-test-place-id')
      expect(found!.dataType).toBe('location')
      expect(found!.payload).toEqual({ name: 'Test Business' })
      expect(found!.googleAttribution).toBe('Google')
    })

    it('updates on conflict (same propertyId + dataType)', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))
      const entry = buildTestCacheEntry()
      await repo.upsert(entry)

      const updated = buildTestCacheEntry({
        gbpPlaceId: 'ChIJ-updated-place',
        payload: { name: 'Updated Business' },
      })
      await repo.upsert(updated)

      const found = await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')
      expect(found!.gbpPlaceId).toBe('ChIJ-updated-place')
      expect(found!.payload).toEqual({ name: 'Updated Business' })
    })

    it('returns null when no entry exists for given type', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))
      // 'location' is the only valid type now; no entry inserted in this scope
      expect(await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')).toBeNull()
    })
  })

  describe('deleteByProperty', () => {
    it('deletes cache entries by property', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))
      await repo.upsert(buildTestCacheEntry({ dataType: 'location' }))

      await repo.deleteByProperty(PROP_A, ORG_A)
      const found = await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')
      expect(found).toBeNull()
    })
  })

  describe('deleteAllExpired', () => {
    it('deletes entries with past expiry', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))
      await repo.upsert(
        buildTestCacheEntry({
          dataType: 'location',
          expiresAt: new Date('2020-01-01T00:00:00Z'),
        }),
      )

      const count = await repo.deleteAllExpired()
      expect(count).toBeGreaterThanOrEqual(1)

      const found = await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')
      expect(found).toBeNull()
    })
  })

  describe('tenant isolation', () => {
    it('findByPropertyAndType returns null for different org', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))

      // Upsert a cache entry for ORG_B's property
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_B,
          propertyId: PROP_B,
          gbpPlaceId: 'ChIJ-orgb-place',
        }),
      )

      // Querying ORG_A with PROP_B should return null — cross-tenant access denied
      const found = await repo.findByPropertyAndType(ORG_A, PROP_B, 'location')
      expect(found).toBeNull()

      // But ORG_B should find its own entry
      const ownEntry = await repo.findByPropertyAndType(ORG_B, PROP_B, 'location')
      expect(ownEntry).not.toBeNull()
      expect(ownEntry!.gbpPlaceId).toBe('ChIJ-orgb-place')
    })

    it('deleteByProperty does not delete other org cache entries', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))

      // Upsert cache entries for both orgs
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_A,
          propertyId: PROP_A,
          gbpPlaceId: 'ChIJ-orga-place',
        }),
      )
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_B,
          propertyId: PROP_B,
          gbpPlaceId: 'ChIJ-orgb-place',
        }),
      )

      // Delete ORG_A's cache entries
      await repo.deleteByProperty(PROP_A, ORG_A)

      // ORG_A's entry should be gone
      expect(await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')).toBeNull()

      // ORG_B's entry should still exist
      const orgBEntry = await repo.findByPropertyAndType(ORG_B, PROP_B, 'location')
      expect(orgBEntry).not.toBeNull()
      expect(orgBEntry!.gbpPlaceId).toBe('ChIJ-orgb-place')
    })

    it('deleteByConnectionId does not delete other org cache entries', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))

      // Upsert cache entries for both orgs
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_A,
          propertyId: PROP_A,
          gbpPlaceId: 'ChIJ-orga-conn',
        }),
      )
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_B,
          propertyId: PROP_B,
          gbpPlaceId: 'ChIJ-orgb-conn',
        }),
      )

      // Delete ORG_A's cache by connection — should only affect ORG_A's properties
      const deleted = await repo.deleteByConnectionId(CONNECTION_ID_A, ORG_A)
      expect(deleted).toBeGreaterThanOrEqual(1)

      // ORG_A's entry should be gone
      expect(await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')).toBeNull()

      // ORG_B's entry should still exist
      const orgBEntry = await repo.findByPropertyAndType(ORG_B, PROP_B, 'location')
      expect(orgBEntry).not.toBeNull()
      expect(orgBEntry!.gbpPlaceId).toBe('ChIJ-orgb-conn')
    })

    it('upsert does not overwrite other org cache entry with same propertyId', async () => {
      const db = getDb()
      const repo = createGbpCacheRepository(db, testPropertyQuery(db))

      // Upsert cache for ORG_A with PROP_A
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_A,
          propertyId: PROP_A,
          gbpPlaceId: 'ChIJ-orga-unique',
          payload: { name: 'Org A Business' },
        }),
      )

      // Upsert cache for ORG_B with PROP_A (same propertyId, different org)
      // This is unusual — different orgs shouldn't share a property — but the unique
      // constraint is on (organization_id, property_id, data_type), so this should
      // create a separate row.
      await repo.upsert(
        buildTestCacheEntry({
          organizationId: ORG_B,
          propertyId: PROP_A,
          gbpPlaceId: 'ChIJ-orgb-unique',
          payload: { name: 'Org B Business' },
        }),
      )

      // Both entries should exist independently
      const orgAEntry = await repo.findByPropertyAndType(ORG_A, PROP_A, 'location')
      expect(orgAEntry).not.toBeNull()
      expect(orgAEntry!.gbpPlaceId).toBe('ChIJ-orga-unique')
      expect(orgAEntry!.payload).toEqual({ name: 'Org A Business' })

      const orgBEntry = await repo.findByPropertyAndType(ORG_B, PROP_A, 'location')
      expect(orgBEntry).not.toBeNull()
      expect(orgBEntry!.gbpPlaceId).toBe('ChIJ-orgb-unique')
      expect(orgBEntry!.payload).toEqual({ name: 'Org B Business' })
    })
  })
})
