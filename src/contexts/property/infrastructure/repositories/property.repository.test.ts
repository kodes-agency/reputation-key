// Property context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.
//
// These tests require DATABASE_URL to be set and a reachable Postgres.
// In CI, the database must be available — tests will fail loudly if not.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPropertyRepository } from './property.repository'
import { getDb } from '#/shared/db'
import { buildTestProperty } from '#/shared/testing/fixtures'
import { seedTestProperty } from '../property-test-fixtures'
import { organizationId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-prop-test-1111-111111111111')
const ORG_B = organizationId('org-prop-test-2222-222222222222')

let pool: Pool

async function truncateProperties(pool: Pool) {
  // Only delete properties from our test orgs to avoid affecting parallel test files
  await pool.query('DELETE FROM properties WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
}

async function seedOrg(pool: Pool, ids: string[]) {
  for (const id of ids) {
    const slug = 't-' + id.slice(-20)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  // Verify database is reachable — fail loudly in CI if not
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateProperties(pool)
  await seedOrg(pool, [ORG_A, ORG_B])
})

describe('propertyRepository (integration)', () => {
  describe('findById', () => {
    it('retrieves a property', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const property = buildTestProperty({
        id: 'prop-insert-test',
        organizationId: ORG_A,
        name: 'Grand Hotel',
        slug: 'grand-hotel',
      })

      await seedTestProperty(getDb(), property)

      const found = await repo.findById(ORG_A, property.id as never)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Grand Hotel')
      expect(found!.slug).toBe('grand-hotel')
    })
  })

  describe('tenant isolation', () => {
    it('does not return properties from other organizations', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const propertyA = buildTestProperty({
        id: 'prop-org-a',
        organizationId: ORG_A,
        slug: 'hotel-a',
      })
      const propertyB = buildTestProperty({
        id: 'prop-org-b',
        organizationId: ORG_B,
        slug: 'hotel-b',
      })

      await seedTestProperty(getDb(), propertyA)
      await seedTestProperty(getDb(), propertyB)

      const fromA = await repo.findById(ORG_A, propertyA.id as never)
      expect(fromA?.id).toBe(propertyA.id)

      const crossTenant = await repo.findById(ORG_A, propertyB.id as never)
      expect(crossTenant).toBeNull()
    })

    it('slugExists does not leak across tenants', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const propertyA = buildTestProperty({
        id: 'prop-slug-a',
        organizationId: ORG_A,
        slug: 'shared-slug',
      })

      await seedTestProperty(getDb(), propertyA)

      expect(await repo.slugExists(ORG_B, 'shared-slug')).toBe(false)
      expect(await repo.slugExists(ORG_A, 'shared-slug')).toBe(true)
    })

    it('list only returns properties for the given organization', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const pA = buildTestProperty({ id: 'p-a1', organizationId: ORG_A, slug: 'a1' })
      const pB = buildTestProperty({ id: 'p-b1', organizationId: ORG_B, slug: 'b1' })

      await seedTestProperty(getDb(), pA)
      await seedTestProperty(getDb(), pB)

      const orgAList = await repo.list(ORG_A)
      expect(orgAList).toHaveLength(1)
      expect(orgAList[0].id).toBe(pA.id)

      const orgBList = await repo.list(ORG_B)
      expect(orgBList).toHaveLength(1)
      expect(orgBList[0].id).toBe(pB.id)
    })
  })

  // The one cross-tenant read: a Google notification names a location before
  // any tenant is known, and a location is unique only within an Organization.
  describe('listByGbpLocationId', () => {
    const holding = (id: string, org: typeof ORG_A, location: string) =>
      buildTestProperty({
        id,
        organizationId: org,
        slug: id,
        googleBindingState: 'account_confirmation_required',
        gbpLocationId: location,
      })

    it('returns every Property that holds the location, in every Organization, in a fixed order', async () => {
      const repo = createPropertyRepository(getDb())
      const inB = holding('prop-loc-b', ORG_B, 'location-shared')
      const inA = holding('prop-loc-a', ORG_A, 'location-shared')
      const elsewhere = holding('prop-loc-other', ORG_A, 'location-other')
      const deleted = {
        ...holding('prop-loc-deleted', ORG_B, 'location-shared'),
        deletedAt: new Date('2026-04-11T12:00:00Z'),
      }
      // Inserted in the opposite order to the one the answer must have.
      await seedTestProperty(getDb(), inB)
      await seedTestProperty(getDb(), deleted)
      await seedTestProperty(getDb(), elsewhere)
      await seedTestProperty(getDb(), inA)

      const holders = await repo.listByGbpLocationId('location-shared')

      expect(holders.map((property) => [property.organizationId, property.id])).toEqual([
        [ORG_A, inA.id],
        [ORG_B, inB.id],
      ])
    })

    it('returns nothing for a location no Property holds', async () => {
      const repo = createPropertyRepository(getDb())
      await seedTestProperty(getDb(), holding('prop-loc-only', ORG_A, 'location-held'))

      await expect(repo.listByGbpLocationId('location-unheld')).resolves.toEqual([])
    })
  })
})
