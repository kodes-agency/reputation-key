// Staff context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.
//
// Uses unique org/property IDs to avoid conflicts with parallel test files.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createStaffAssignmentRepository } from './staff-assignment.repository'
import { getDb } from '#/shared/db'
import { buildTestStaffAssignment } from '#/shared/testing/fixtures'
import { organizationId, userId, propertyId, teamId } from '#/shared/domain/ids'
import type { UserId, PropertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

// Unique org IDs for staff tests (won't collide with property/team integration tests)
const ORG_A = organizationId('org-staff-test-5555-555555555555')
const ORG_B = organizationId('org-staff-test-6666-666666666666')
const USER_1 = userId('user-00000000-0000-0000-0000-000000000001') as UserId
const USER_2 = userId('user-00000000-0000-0000-0000-000000000002') as UserId
const PROP_A1 = propertyId('d1000000-0000-0000-0000-000000000001') as PropertyId
const PROP_A2 = propertyId('d1000000-0000-0000-0000-000000000002') as PropertyId
const PROP_B1 = propertyId('d1000000-0000-0000-0000-000000000003') as PropertyId

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
  await seedProperty(pool, PROP_A1, ORG_A, 'staff-test-a1')
  await seedProperty(pool, PROP_A2, ORG_A, 'staff-test-a2')
  await seedProperty(pool, PROP_B1, ORG_B, 'staff-test-b1')
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  // Only truncate the table under test — re-seed properties (parallel tests may have deleted them)
  await pool.query('TRUNCATE TABLE staff_assignments CASCADE')
  await seedProperty(pool, PROP_A1, ORG_A, 'staff-test-a1')
  await seedProperty(pool, PROP_A2, ORG_A, 'staff-test-a2')
  await seedProperty(pool, PROP_B1, ORG_B, 'staff-test-b1')
})

describe('staffAssignmentRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a staff assignment', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const assignment = buildTestStaffAssignment({
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })

      await repo.insert(ORG_A, assignment)

      const found = await repo.findById(ORG_A, assignment.id as never)
      expect(found).not.toBeNull()
      expect(found!.userId).toBe(USER_1)
      expect(found!.propertyId).toBe(PROP_A1)
      expect(found!.teamId).toBeNull()
    })
  })

  describe('tenant isolation', () => {
    it('does not return assignments from other organizations', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const aA = buildTestStaffAssignment({
        id: 'staff-org-a',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })
      const aB = buildTestStaffAssignment({
        id: 'staff-org-b',
        organizationId: ORG_B,
        userId: USER_1,
        propertyId: PROP_B1,
      })

      await repo.insert(ORG_A, aA)
      await repo.insert(ORG_B, aB)

      const fromA = await repo.findById(ORG_A, aA.id as never)
      expect(fromA?.id).toBe(aA.id)

      const crossTenant = await repo.findById(ORG_A, aB.id as never)
      expect(crossTenant).toBeNull()
    })

    it('listByUser only returns assignments for the given organization', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const aA = buildTestStaffAssignment({
        id: 'staff-user-a',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })
      const aB = buildTestStaffAssignment({
        id: 'staff-user-b',
        organizationId: ORG_B,
        userId: USER_1,
        propertyId: PROP_B1,
      })

      await repo.insert(ORG_A, aA)
      await repo.insert(ORG_B, aB)

      const orgAList = await repo.listByUser(ORG_A, USER_1)
      expect(orgAList).toHaveLength(1)
      expect(orgAList[0].id).toBe(aA.id)

      const orgBList = await repo.listByUser(ORG_B, USER_1)
      expect(orgBList).toHaveLength(1)
      expect(orgBList[0].id).toBe(aB.id)
    })

    it('listByProperty only returns assignments for the given organization', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const aA = buildTestStaffAssignment({
        id: 'staff-prop-a',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })

      await repo.insert(ORG_A, aA)

      const orgAList = await repo.listByProperty(ORG_A, PROP_A1)
      expect(orgAList).toHaveLength(1)

      const orgBList = await repo.listByProperty(ORG_B, PROP_A1)
      expect(orgBList).toHaveLength(0)
    })
  })

  describe('assignmentExists', () => {
    it('detects existing direct (no team) assignment', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const assignment = buildTestStaffAssignment({
        id: 'staff-exists-1',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
        teamId: null,
      })

      await repo.insert(ORG_A, assignment)

      expect(await repo.assignmentExists(ORG_A, USER_1, PROP_A1, null)).toBe(true)
      expect(await repo.assignmentExists(ORG_A, USER_2, PROP_A1, null)).toBe(false)
    })

    it('distinguishes between direct and team assignments', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const TEST_TEAM = teamId('10000000-0000-0000-0000-000000000001')

      // Seed a team for the FK
      await pool.query(
        `INSERT INTO teams (id, organization_id, property_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, 'Test Team', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [TEST_TEAM, ORG_A, PROP_A1],
      )

      // Direct assignment (no team)
      const direct = buildTestStaffAssignment({
        id: 'staff-direct',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
        teamId: null,
      })
      await repo.insert(ORG_A, direct)

      // Direct assignment should NOT match a team-based check
      expect(await repo.assignmentExists(ORG_A, USER_1, PROP_A1, TEST_TEAM)).toBe(false)
      // Direct assignment SHOULD match a null-team check
      expect(await repo.assignmentExists(ORG_A, USER_1, PROP_A1, null)).toBe(true)
    })
  })

  describe('softDelete', () => {
    it('removes assignment from queries but preserves row', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)
      const assignment = buildTestStaffAssignment({
        id: 'staff-del',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })

      await repo.insert(ORG_A, assignment)
      await repo.softDelete(ORG_A, assignment.id as never)

      const found = await repo.findById(ORG_A, assignment.id as never)
      expect(found).toBeNull()

      const listed = await repo.listByProperty(ORG_A, PROP_A1)
      expect(listed).toHaveLength(0)
    })
  })

  describe('getAccessiblePropertyIds', () => {
    it('returns distinct property IDs for a user', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)

      const a1 = buildTestStaffAssignment({
        id: 'staff-acc-1',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })
      const a2 = buildTestStaffAssignment({
        id: 'staff-acc-2',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A2,
      })

      await repo.insert(ORG_A, a1)
      await repo.insert(ORG_A, a2)

      const ids = await repo.getAccessiblePropertyIds(ORG_A, USER_1)
      expect(ids).toHaveLength(2)

      const idSet = new Set(ids)
      expect(idSet.has(PROP_A1)).toBe(true)
      expect(idSet.has(PROP_A2)).toBe(true)
    })

    it('does not leak properties from other organizations', async () => {
      const db = getDb()
      const repo = createStaffAssignmentRepository(db)

      const aA = buildTestStaffAssignment({
        id: 'staff-cross-a',
        organizationId: ORG_A,
        userId: USER_1,
        propertyId: PROP_A1,
      })
      const aB = buildTestStaffAssignment({
        id: 'staff-cross-b',
        organizationId: ORG_B,
        userId: USER_1,
        propertyId: PROP_B1,
      })

      await repo.insert(ORG_A, aA)
      await repo.insert(ORG_B, aB)

      const orgAIds = await repo.getAccessiblePropertyIds(ORG_A, USER_1)
      expect(orgAIds).toHaveLength(1)
      expect(orgAIds[0]).toBe(PROP_A1)
    })
  })
})
