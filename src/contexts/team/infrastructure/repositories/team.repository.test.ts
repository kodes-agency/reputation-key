// Team context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.
//
// Uses unique org/property IDs to avoid conflicts with parallel test files.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTeamRepository } from './team.repository'
import { getDb } from '#/shared/db'
import { buildTestTeam } from '#/shared/testing/fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PropertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

// Unique org IDs for team tests (won't collide with property/staff integration tests)
const ORG_A = organizationId('org-team-test-3333-333333333333')
const ORG_B = organizationId('org-team-test-4444-444444444444')
const PROP_A1 = propertyId('c1000000-0000-0000-0000-000000000001') as PropertyId
const PROP_A2 = propertyId('c1000000-0000-0000-0000-000000000002') as PropertyId
const PROP_B1 = propertyId('c1000000-0000-0000-0000-000000000003') as PropertyId

let pool: Pool

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

async function seedProperty(pool: Pool, id: string, orgId: string, slug: string) {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, orgId, `Property ${slug}`, slug],
  )
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const client = await pool.connect()
  client.release()

  // Seed shared dependencies once (survives parallel test runs)
  await seedOrg(pool, [ORG_A, ORG_B])
  await seedProperty(pool, PROP_A1, ORG_A, 'team-test-a1')
  await seedProperty(pool, PROP_A2, ORG_A, 'team-test-a2')
  await seedProperty(pool, PROP_B1, ORG_B, 'team-test-b1')
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  // Only truncate the table under test — re-seed properties (parallel tests may have deleted them)
  await pool.query('TRUNCATE TABLE teams CASCADE')
  await seedProperty(pool, PROP_A1, ORG_A, 'team-test-a1')
  await seedProperty(pool, PROP_A2, ORG_A, 'team-test-a2')
  await seedProperty(pool, PROP_B1, ORG_B, 'team-test-b1')
})

describe('teamRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a team', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const team = buildTestTeam({
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Front Desk',
      })

      await repo.insert(ORG_A, team)

      const found = await repo.findById(ORG_A, team.id as never)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Front Desk')
    })
  })

  describe('tenant isolation', () => {
    it('does not return teams from other organizations', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const teamA = buildTestTeam({
        id: 'team-org-a',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Team A',
      })
      const teamB = buildTestTeam({
        id: 'team-org-b',
        organizationId: ORG_B,
        propertyId: PROP_B1,
        name: 'Team B',
      })

      await repo.insert(ORG_A, teamA)
      await repo.insert(ORG_B, teamB)

      const fromA = await repo.findById(ORG_A, teamA.id as never)
      expect(fromA?.id).toBe(teamA.id)

      const crossTenant = await repo.findById(ORG_A, teamB.id as never)
      expect(crossTenant).toBeNull()
    })

    it('nameExistsInProperty does not leak across tenants', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const teamA = buildTestTeam({
        id: 'team-name-a',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Housekeeping',
      })

      await repo.insert(ORG_A, teamA)

      expect(await repo.nameExistsInProperty(ORG_A, PROP_A1, 'Housekeeping')).toBe(true)
      expect(await repo.nameExistsInProperty(ORG_B, PROP_A1, 'Housekeeping')).toBe(false)
    })

    it('listByProperty only returns teams for the given organization', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const tA1 = buildTestTeam({
        id: 'team-list-a1',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Team A1',
      })

      await repo.insert(ORG_A, tA1)

      const orgAList = await repo.listByProperty(ORG_A, PROP_A1)
      expect(orgAList).toHaveLength(1)
      expect(orgAList[0].id).toBe(tA1.id)

      const orgBList = await repo.listByProperty(ORG_B, PROP_A1)
      expect(orgBList).toHaveLength(0)
    })
  })

  describe('softDelete', () => {
    it('removes team from queries but preserves row', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const team = buildTestTeam({
        id: 'team-del',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'To Delete',
      })

      await repo.insert(ORG_A, team)
      await repo.softDelete(ORG_A, team.id as never)

      const found = await repo.findById(ORG_A, team.id as never)
      expect(found).toBeNull()

      const listed = await repo.listByProperty(ORG_A, PROP_A1)
      expect(listed).toHaveLength(0)
    })

    it('allows a new team with the same name after soft-delete', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const original = buildTestTeam({
        id: 'team-reuse',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Reusable',
      })

      await repo.insert(ORG_A, original)
      await repo.softDelete(ORG_A, original.id as never)

      const replacement = buildTestTeam({
        id: 'team-reuse-2',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Reusable',
      })
      await expect(repo.insert(ORG_A, replacement)).resolves.not.toThrow()
    })
  })

  describe('update', () => {
    it('updates specified fields', async () => {
      const db = getDb()
      const repo = createTeamRepository(db)
      const team = buildTestTeam({
        id: 'team-upd',
        organizationId: ORG_A,
        propertyId: PROP_A1,
        name: 'Old Name',
      })

      await repo.insert(ORG_A, team)
      await repo.update(ORG_A, team.id as never, { name: 'New Name' })

      const found = await repo.findById(ORG_A, team.id as never)
      expect(found!.name).toBe('New Name')
    })
  })
})
