import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  seedStaffAccountFixture,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from '#/shared/testing/staff-account-fixture'
import type {
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { assertPersonalGoalAssignments } from './personal-goal-assignment-guard'
import { createStaffGoalsReader } from './staff-goals.reader'

let lease: TestLease
let db: Database
let fixtures: readonly StaffAccountFixture[] = []
beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
})
afterEach(async () => {
  for (const row of fixtures) {
    for (const table of [
      'goal_subject_assignments',
      'goal_program_versions',
      'goal_programs',
      'portal_group_memberships',
      'portal_groups',
    ])
      await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        row.organizationId,
      ])
    await cleanStaffAccountFixture(lease.pool, row)
  }
  fixtures = []
})
afterAll(async () => lease.release())

async function setup() {
  const row = await seedStaffAccountFixture(lease.pool)
  fixtures = [...fixtures, row]
  const groupId = randomUUID()
  await lease.pool.query(
    "INSERT INTO portal_groups (id, organization_id, property_id, name) VALUES ($1, $2, $3, 'Desk')",
    [groupId, row.organizationId, row.propertyId],
  )
  await lease.pool.query(
    "INSERT INTO portal_group_memberships (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'test')",
    [row.organizationId, row.propertyId, row.portalId, groupId, NOW],
  )
  return { ...row, groupId }
}

describe.sequential('personal Goal SQL guards (PostgreSQL)', () => {
  it.each(['portal', 'portal_group'] as const)(
    'allows an ordinary %s rating Goal and refuses a personal one',
    async (kind) => {
      const row = await setup()
      const version = {
        organizationId: row.organizationId,
        propertyId: row.propertyId,
        metric: 'portal_rating_count',
        effectiveFrom: NOW,
      } as GoalProgramVersion
      const assignment = {
        subject:
          kind === 'portal'
            ? { kind, portalId: row.portalId }
            : { kind, portalGroupId: row.groupId },
      } as GoalSubjectAssignment
      const run = () =>
        db.transaction((tx) => assertPersonalGoalAssignments(tx, version, [assignment]))
      await expect(run()).rejects.toMatchObject({ code: 'staff_scan_only' })
      await lease.pool.query("UPDATE portals SET kind = 'place' WHERE id = $1", [
        row.portalId,
      ])
      await expect(run()).resolves.toBeUndefined()
      await expect(
        db.transaction((tx) => assertPersonalGoalAssignments(tx, version, [])),
      ).resolves.toBeUndefined()
      await expect(
        db.transaction((tx) =>
          assertPersonalGoalAssignments(tx, { ...version, metric: 'qualified_scans' }, [
            assignment,
          ]),
        ),
      ).resolves.toBeUndefined()
    },
  )

  it.each([
    { enabled: false, count: 2, visible: false },
    { enabled: true, count: 2, visible: true },
    { enabled: false, count: 3, visible: true },
  ])('protects Group progress with %j', async ({ enabled, count, visible }) => {
    const row = await setup()
    for (let n = 1; n < count; n += 1) {
      const id = randomUUID()
      await lease.pool.query(
        "INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, kind, public_name) VALUES ($1::uuid,$2,$3::uuid,$3::text,'Staff', $1::text, 'personal', 'Harbor')",
        [id, row.organizationId, row.propertyId],
      )
      await lease.pool.query(
        "INSERT INTO portal_group_memberships (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'test')",
        [row.organizationId, row.propertyId, id, row.groupId, NOW],
      )
    }
    await lease.pool.query(
      "INSERT INTO staff_property_settings (organization_id, property_id, colleague_list_enabled, updated_by) VALUES ($1,$2,$3,'test')",
      [row.organizationId, row.propertyId, enabled],
    )
    const programId = randomUUID()
    const versionId = randomUUID()
    await lease.pool.query(
      "INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by) VALUES ($1,$2,$3,'Scan target','active','test')",
      [programId, row.organizationId, row.propertyId],
    )
    await lease.pool.query(
      "INSERT INTO goal_program_versions (id, program_id, organization_id, property_id, version, metric_definition_id, metric_definition_version_id, metric_key, metric_minimum_sample, target_value, property_timezone, effective_from, change_reason, created_by) VALUES ($1,$2,$3,$4,1,$5,$6,'qualified_scans',0,25,'Europe/Sofia',$7,'created','test')",
      [
        versionId,
        programId,
        row.organizationId,
        row.propertyId,
        METRIC_DEFINITION_IDS.qualifiedScan,
        METRIC_VERSION_IDS.qualifiedScanGoal,
        NOW,
      ],
    )
    await lease.pool.query(
      "INSERT INTO goal_subject_assignments (id, program_id, program_version_id, organization_id, property_id, metric_key, subject_kind, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'qualified_scans','portal_group',$6,$7,'test')",
      [
        randomUUID(),
        programId,
        versionId,
        row.organizationId,
        row.propertyId,
        row.groupId,
        NOW,
      ],
    )
    const goals = createStaffGoalsReader(
      db,
      () => NOW,
      async () => ({
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        metricKey: 'portal.qualified_scan',
        state: 'eligible',
        exactValue: 9,
        sampleCount: 9,
        minimumSample: 0,
        sourceCompleteThrough: NOW,
        reason: null,
      }),
    )
    const result = await goals({
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      portalId: row.portalId,
      groupId: row.groupId,
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
    })
    expect(result).toEqual(
      visible ? [{ id: programId, name: 'Desk', target: 25, scans: 9 }] : [],
    )
  })
})

it('rechecks skipped ratings in a mixed Group at the Goal commit fence (PostgreSQL)', async () => {
  const row = await setup()
  const placeId = randomUUID()
  await lease.pool.query(
    "INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, skip_private_rating) VALUES ($1::uuid,$2,$3::uuid,$3::text,'Room',$1::text,true)",
    [placeId, row.organizationId, row.propertyId],
  )
  await lease.pool.query(
    "INSERT INTO portal_group_memberships (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'test')",
    [row.organizationId, row.propertyId, placeId, row.groupId, NOW],
  )
  const version = {
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    metric: 'qualified_scans',
    effectiveFrom: NOW,
  } as GoalProgramVersion
  const assignment = {
    subject: { kind: 'portal_group', portalGroupId: row.groupId },
  } as GoalSubjectAssignment
  const run = () =>
    db.transaction((tx) => assertPersonalGoalAssignments(tx, version, [assignment]))
  await expect(run()).rejects.toMatchObject({ code: 'staff_private_ratings_skipped' })
  await lease.pool.query('UPDATE portals SET skip_private_rating = false WHERE id = $1', [
    placeId,
  ])
  await expect(run()).resolves.toBeUndefined()
})
