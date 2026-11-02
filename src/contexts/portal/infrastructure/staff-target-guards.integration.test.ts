import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { seedStaffTarget, cleanStaffTarget } from '#/shared/testing/staff-target-fixture'
import { STAFF_FIXTURE_NOW as NOW } from '#/shared/testing/staff-account-fixture'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { assertStaffScanSwitch } from './staff-scan-switch-guard'
import {
  assertPersonalGroupTarget,
  assertPersonalGroupTargetAvailable,
} from './personal-portal-group-guard'
let lease: TestLease, db: Database
let rows: Awaited<ReturnType<typeof seedStaffTarget>>[] = []
beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
})
afterEach(async () => {
  for (const row of rows) await cleanStaffTarget(lease.pool, row)
  rows = []
})
afterAll(async () => lease?.release())
async function seed(
  metric: 'qualified_scans' | 'portal_rating_count' = 'qualified_scans',
) {
  const row = await seedStaffTarget(lease.pool, metric)
  rows.push(row)
  return row
}
it('executes the staff scan-switch SQL against a running Group target', async () => {
  const row = await seed()
  const run = () =>
    db.transaction((tx) =>
      assertStaffScanSwitch(tx, {
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        portalId: portalId(row.portalId),
        patch: { skipPrivateRating: true },
        revision: NOW,
      }),
    )
  await expect(run()).rejects.toMatchObject({ code: 'running_rating_goal' })
  await lease.pool.query(
    "UPDATE goal_programs SET status = 'ended' WHERE organization_id = $1",
    [row.organizationId],
  )
  await expect(run()).resolves.toBeUndefined()
})
it.each(['incoming', 'existing'] as const)(
  'executes the second membership query for %s skipped ratings',
  async (side) => {
    const row = await seed()
    const skipId = side === 'incoming' ? row.placeId : row.portalId
    await lease.pool.query(
      'UPDATE portals SET skip_private_rating = true WHERE id = $1',
      [skipId],
    )
    const scope = { ...row, portalId: row.placeId, portalGroupId: row.groupId, at: NOW }
    await expect(
      db.transaction((tx) => assertPersonalGroupTarget(tx, scope)),
    ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
    await lease.pool.query(
      'UPDATE portals SET skip_private_rating = false WHERE id = $1',
      [skipId],
    )
    await expect(
      db.transaction((tx) => assertPersonalGroupTarget(tx, scope)),
    ).resolves.toBeUndefined()
  },
)
it('preflights a prospective person against a running rating Group target', async () => {
  const row = await seed('portal_rating_count')
  await expect(
    assertPersonalGroupTargetAvailable(db, {
      ...row,
      portalGroupId: row.groupId,
      at: NOW,
    }),
  ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
})

it('also fences an individual personal target and a room in a staff Group', async () => {
  const row = await seed()
  await lease.pool.query(
    "UPDATE goal_subject_assignments SET subject_kind = 'portal', portal_id = $1, portal_group_id = NULL WHERE organization_id = $2",
    [row.portalId, row.organizationId],
  )
  const run = (id: string) =>
    db.transaction((tx) =>
      assertStaffScanSwitch(tx, {
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        portalId: portalId(id),
        patch: { skipPrivateRating: true },
        revision: NOW,
      }),
    )
  await expect(run(row.portalId)).rejects.toMatchObject({ code: 'running_rating_goal' })
  await expect(run(row.placeId)).resolves.toBeUndefined()
  await lease.pool.query(
    "UPDATE goal_subject_assignments SET subject_kind = 'portal_group', portal_id = NULL, portal_group_id = $1 WHERE organization_id = $2",
    [row.groupId, row.organizationId],
  )
  await lease.pool.query(
    "INSERT INTO portal_group_memberships (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'test')",
    [row.organizationId, row.propertyId, row.placeId, row.groupId, NOW],
  )
  await expect(run(row.placeId)).rejects.toMatchObject({ code: 'running_rating_goal' })
})
