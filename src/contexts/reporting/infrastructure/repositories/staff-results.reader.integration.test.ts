import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  seedStaffAccountFixture,
  seedStaffAccountUser,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from '#/shared/testing/staff-account-fixture'
import { createStaffSelfReader } from '#/contexts/identity/infrastructure/adapters/staff-self.reader'
import { createStaffResultsReader } from './staff-results.reader'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

let lease: TestLease
let db: Database
let fixtures: StaffAccountFixture[] = []
beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
})
afterEach(async () => {
  for (const row of fixtures) await cleanStaffAccountFixture(lease.pool, row)
  fixtures = []
})
afterAll(async () => lease.release())
const seed = async () => {
  const row = await seedStaffAccountFixture(lease.pool)
  fixtures = [...fixtures, row]
  return row
}
const scope = (row: StaffAccountFixture) => ({
  organizationId: row.organizationId,
  propertyId: row.propertyId,
  portalId: row.portalId,
  timezone: 'Europe/Sofia',
  countryCode: 'BG',
  groupId: null,
})
const reader = () =>
  createStaffResultsReader(
    db,
    () => NOW,
    async () => {
      throw new Error('No Goal Program should be queried')
    },
  )

async function reading(
  row: StaffAccountFixture,
  kind: 'scan' | 'rating',
  at: string,
  value = 1,
  recordedAt = new Date('2026-11-03T21:59:30Z'),
) {
  const id = randomUUID()
  await lease.pool.query(
    `INSERT INTO metric_readings (id, organization_id, property_id, portal_id, metric_key, value, exact_value, definition_version_id, source_event_id, source_policy, sample_count, attribution_quality, event_at, property_local_date, data_quality, retention_class, recorded_at)
    VALUES ($1::uuid, $2, $3, $4, $5, $6::real, $6::numeric, $7, $1::varchar, $8, 1, 'exact', $9, $10, 'exact', 'guest_gateway_24_month', $11)`,
    [
      id,
      row.organizationId,
      row.propertyId,
      row.portalId,
      kind === 'scan' ? 'portal.qualified_scan' : 'portal.rating',
      value,
      kind === 'scan'
        ? METRIC_VERSION_IDS.qualifiedScanGoal
        : METRIC_VERSION_IDS.portalRatingAnalytics,
      kind === 'scan' ? 'first_party_guest_gateway_metric' : 'first_party_guest_private',
      new Date(at),
      at.slice(0, 10),
      recordedAt,
    ],
  )
  return id
}

describe.sequential('staff private results and accepted roster (PostgreSQL)', () => {
  it('finds own personal participations and pauses a closing or deleted Property', async () => {
    const row = await seed()
    await seedStaffAccountUser(lease.pool, row)
    await lease.pool.query(
      "INSERT INTO staff_user_links (organization_id, staff_participant_id, user_id, effective_from, created_by) VALUES ($1,$2,$3,$4,'test')",
      [row.organizationId, row.participantId, row.userId, NOW],
    )
    await lease.pool.query(
      "UPDATE portals SET publication_state = 'published' WHERE id = $1",
      [row.portalId],
    )
    const reader = createStaffSelfReader(db, () => NOW)
    const find = () => reader.find(row.organizationId, row.userId)
    expect(await find()).toMatchObject({
      participantId: row.participantId,
      participations: [
        {
          participationId: row.participationId,
          propertyActive: true,
          portalState: 'live',
        },
      ],
    })
    await lease.pool.query(
      "UPDATE properties SET lifecycle_state = 'suspended' WHERE id = $1",
      [row.propertyId],
    )
    expect(await find()).toMatchObject({
      participations: [{ propertyActive: false, portalState: 'paused' }],
    })
    await lease.pool.query(
      "UPDATE properties SET lifecycle_state = 'active', deleted_at = $2 WHERE id = $1",
      [row.propertyId, NOW],
    )
    expect(await find()).toMatchObject({
      participations: [{ propertyActive: false, portalState: 'paused' }],
    })
  })
  it('counts 23:59 yesterday, omits 00:01 today and withholds an average under five', async () => {
    const row = await seed()
    await reading(row, 'rating', '2026-11-03T21:59:00Z', 5)
    await reading(row, 'rating', '2026-11-03T22:01:00Z', 1)
    await reading(row, 'scan', '2026-11-04T09:00:00Z')
    expect(await reader().results(scope(row), 'week')).toEqual({
      scans: 1,
      ratingCount: 1,
      ratingsCutoff: '2026-11-03T22:00:00.000Z',
    })
    expect(await reader().results(scope(row), 'today')).toEqual({ scans: 1 })
  })
  it('shows an average from five ratings and excludes another personal Portal', async () => {
    const row = await seed()
    const other = await seed()
    for (const value of [5, 4, 3, 4, 4])
      await reading(row, 'rating', '2026-11-03T10:00:00Z', value)
    await reading(other, 'rating', '2026-11-03T10:00:00Z', 1)
    expect(await reader().results(scope(row), 'month')).toEqual({
      scans: 0,
      ratingCount: 5,
      averageRating: 4,
      ratingsCutoff: '2026-11-03T22:00:00.000Z',
    })
  })
  it('keeps late projection and a correction after midnight out of that day rating figure', async () => {
    const row = await seed()
    const id = await reading(row, 'rating', '2026-11-03T10:00:00Z', 5)
    await lease.pool.query(
      `INSERT INTO metric_corrections (reading_id, source_event_id, kind, reason, actor_type, actor_id, replacement_value, event_at, recorded_at) VALUES ($1, $2, 'replace', 'test', 'system', 'test', 1, $3, $3)`,
      [id, randomUUID(), new Date('2026-11-04T10:00:00Z')],
    )
    await reading(
      row,
      'rating',
      '2026-11-03T20:00:00Z',
      1,
      new Date('2026-11-04T10:00:00Z'),
    )
    expect((await reader().results(scope(row), 'week')).ratingCount).toBe(1)
  })
  it('includes accepted zero-scan colleagues in name order and excludes unaccepted and removed people', async () => {
    const row = await seed()
    await seedStaffAccountUser(lease.pool, row)
    await lease.pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'member', $4)`,
      [randomUUID(), row.organizationId, row.userId, NOW],
    )
    await lease.pool.query(
      `INSERT INTO staff_user_links (organization_id, staff_participant_id, user_id, effective_from, created_by) VALUES ($1, $2, $3, $4, 'manager')`,
      [row.organizationId, row.participantId, row.userId, new Date(NOW.getTime() - 1000)],
    )
    const pending = randomUUID()
    await lease.pool.query(
      `INSERT INTO staff_participants (id, organization_id, display_name, created_by) VALUES ($1, $2, 'Unaccepted', 'manager')`,
      [pending, row.organizationId],
    )
    await lease.pool.query(
      `INSERT INTO staff_participations (organization_id, property_id, staff_participant_id, display_name, created_by) VALUES ($1, $2, $3, 'Unaccepted', 'manager')`,
      [row.organizationId, row.propertyId, pending],
    )
    const roster = await createStaffSelfReader(db, () => NOW).colleagues(
      row.organizationId,
      row.propertyId,
    )
    expect(roster.map((person) => person.displayName)).toEqual(['Polly Smith'])
    const counts = await reader().scans(
      scope(row),
      roster.map((person) => person.portalId),
      'week',
    )
    expect([...counts]).toEqual([[row.portalId, 0]])
    await lease.pool.query(
      `UPDATE staff_participations SET status = 'archived', ended_at = $2, archive_reason = 'removed' WHERE id = $1`,
      [row.participationId, NOW],
    )
    expect(
      await createStaffSelfReader(db, () => NOW).colleagues(
        row.organizationId,
        row.propertyId,
      ),
    ).toEqual([])
  })
})
