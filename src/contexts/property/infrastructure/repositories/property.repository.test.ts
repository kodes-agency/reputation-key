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
import { organizationId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-prop-test-1111-111111111111')
const ORG_B = organizationId('org-prop-test-2222-222222222222')

let pool: Pool

async function truncateProperties(pool: Pool) {
  // Only delete properties from our test orgs to avoid affecting parallel test files
  await pool.query('DELETE FROM staff_assignments WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM teams WHERE organization_id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.query('DELETE FROM properties WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
}

async function seedOrg(pool: Pool, ids: string[]) {
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
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
  describe('insert and findById', () => {
    it('inserts and retrieves a property', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const property = buildTestProperty({
        organizationId: ORG_A,
        name: 'Grand Hotel',
        slug: 'grand-hotel',
      })

      await repo.insert(ORG_A, property)

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

      await repo.insert(ORG_A, propertyA)
      await repo.insert(ORG_B, propertyB)

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

      await repo.insert(ORG_A, propertyA)

      expect(await repo.slugExists(ORG_B, 'shared-slug')).toBe(false)
      expect(await repo.slugExists(ORG_A, 'shared-slug')).toBe(true)
    })

    it('list only returns properties for the given organization', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const pA = buildTestProperty({ id: 'p-a1', organizationId: ORG_A, slug: 'a1' })
      const pB = buildTestProperty({ id: 'p-b1', organizationId: ORG_B, slug: 'b1' })

      await repo.insert(ORG_A, pA)
      await repo.insert(ORG_B, pB)

      const orgAList = await repo.list(ORG_A)
      expect(orgAList).toHaveLength(1)
      expect(orgAList[0].id).toBe(pA.id)

      const orgBList = await repo.list(ORG_B)
      expect(orgBList).toHaveLength(1)
      expect(orgBList[0].id).toBe(pB.id)
    })
  })

  describe('softDelete', () => {
    it('removes property from queries but preserves row', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const property = buildTestProperty({
        id: 'prop-del',
        organizationId: ORG_A,
        slug: 'to-delete',
      })

      await repo.insert(ORG_A, property)
      await repo.softDelete(ORG_A, property.id as never)

      const found = await repo.findById(ORG_A, property.id as never)
      expect(found).toBeNull()

      const listed = await repo.list(ORG_A)
      expect(listed).toHaveLength(0)
    })

    it('allows a new property with the same slug after soft-delete', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const original = buildTestProperty({
        id: 'prop-reuse',
        organizationId: ORG_A,
        slug: 'reusable-slug',
      })

      await repo.insert(ORG_A, original)
      await repo.softDelete(ORG_A, original.id as never)

      const replacement = buildTestProperty({
        id: 'prop-reuse-2',
        organizationId: ORG_A,
        slug: 'reusable-slug',
      })
      await expect(repo.insert(ORG_A, replacement)).resolves.not.toThrow()
    })
  })

  describe('update', () => {
    it('updates specified fields', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const property = buildTestProperty({
        id: 'prop-upd',
        organizationId: ORG_A,
        slug: 'to-update',
        name: 'Old Name',
      })

      await repo.insert(ORG_A, property)
      await repo.update(ORG_A, property.id as never, { name: 'New Name' })

      const found = await repo.findById(ORG_A, property.id as never)
      expect(found!.name).toBe('New Name')
    })
  })
})
