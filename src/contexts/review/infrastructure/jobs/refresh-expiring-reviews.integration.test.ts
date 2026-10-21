// Review context — the hourly refresh sweep (real PostgreSQL behind the real
// Review, run and discovery repositories).
//
// It enqueues no sync: it moves the discovery schedule of a Property whose
// reviews are about to expire (ADR 0055, note of 2026-10-21 (e)). The first
// group below proves the move; the second group is S10-01.
//
// S10-01: the sweep meets a Review Google deleted.
//
// The sweep walks every Organization's reviews whose content clock falls in
// the next five days, oldest clock first. A Review the snapshot sync erased
// (`provider_deleted`) used to keep its clock, sort first in that walk and
// make the row mapper throw, so the run recorded `failed` with the cursor it
// started from and the next run met the same row: the sweep never advanced
// again, for every Organization. The erased row is not a refresh candidate;
// the live rows behind it must still be enqueued.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  insertLegacyTombstone,
  insertLiveReview,
} from '#/shared/testing/review-tombstone-fixtures'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createReviewDiscoveryRepository } from '../repositories/review-discovery.repository'
import { createReviewRepository } from '../repositories/review.repository'
import { createReviewRefreshRunRepository } from '../repositories/review-refresh-run.repository'
import { eraseReviewSourceContent } from '../review-source-content-store'
import { createRefreshExpiringReviewsHandler } from './refresh-expiring-reviews.job'

const ORG = organizationId('org-refresh-sweep-tombstone-11111111')
const PROPERTY = propertyId('7e200000-0000-4000-8000-000000000001')
const CONNECTION = '7e200000-0000-4000-8000-0000000000c1'
const LIVE_DUE = reviewId('7e200000-0000-4000-8000-0000000000a1')
const SECOND_LIVE_DUE = reviewId('7e200000-0000-4000-8000-0000000000a2')
const TOMBSTONE = reviewId('7e200000-0000-4000-8000-0000000000a3')
const LOCATION = 'locations/refresh-sweep'
const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments

// The sweep is cross-tenant. A clock in 1900 keeps rows other suites leave
// behind out of its five-day window.
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('1900-06-01T12:00:00.000Z')
const fetchedDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const clockOf = (lastFetchedAt: Date) => new Date(lastFetchedAt.getTime() + 30 * DAY_MS)

let pool: Pool
const db = getDb()

async function clean(): Promise<void> {
  await pool.query('DELETE FROM review_refresh_runs')
  await pool.query(
    'DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM review_sync_state WHERE property_id = $1', [PROPERTY])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  // Properties first: deleting a connection nulls the one a bound Property holds.
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedTenant(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Refresh sweep tombstone', $2, NOW())`,
    [ORG, `refresh-sweep-tombstone-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Refresh sweep property', $3, 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG, `refresh-sweep-property-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by, status
     ) VALUES ($1, $2, $3, 'tok', 'rtok', NOW(), ARRAY['x'], 'user-1', 'active')`,
    [CONNECTION, ORG, `subject-refresh-sweep-${process.pid}`],
  )
  // The sweep offers only reviews a sync can still run for: the Property is
  // bound to Google through the connection the reviews were fetched with.
  await pool.query(
    `UPDATE properties
        SET google_connection_id = $1, gbp_account_id = $2, gbp_location_id = $3,
            google_binding_state = 'active'
      WHERE id = $4`,
    [CONNECTION, GBP_ACCOUNT_ID, GBP_LOCATION_ID, PROPERTY],
  )
}

/** A Review in the refresh window: fetched 26 days before NOW, clock 4 days out. */
async function insertDueReview(id: string, externalId: string, location: string) {
  const lastFetchedAt = fetchedDaysAgo(26)
  await insertLiveReview(pool, {
    id,
    organizationId: ORG,
    propertyId: PROPERTY,
    externalId,
    externalLocationId: location,
    googleConnectionId: CONNECTION,
    lastFetchedAt,
    contentExpiresAt: clockOf(lastFetchedAt),
  })
}

/** An erased row whose clock sorts BEFORE every live row in the window. */
async function insertTombstoneKeepingItsClock(): Promise<void> {
  const lastFetchedAt = fetchedDaysAgo(28)
  await insertLegacyTombstone(pool, {
    id: TOMBSTONE,
    organizationId: ORG,
    propertyId: PROPERTY,
    lastFetchedAt,
    contentExpiresAt: clockOf(lastFetchedAt),
  })
}

/** The same row erased by today's lifecycle, which also clears the clock. */
async function insertTombstoneErasedToday(): Promise<void> {
  const lastFetchedAt = fetchedDaysAgo(28)
  await insertLiveReview(pool, {
    id: TOMBSTONE,
    organizationId: ORG,
    propertyId: PROPERTY,
    externalId: 'refresh-sweep-erased-today',
    googleConnectionId: CONNECTION,
    lastFetchedAt,
    contentExpiresAt: clockOf(lastFetchedAt),
  })
  const erased = await db.transaction((tx) =>
    eraseReviewSourceContent(tx, {
      reviewId: TOMBSTONE,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      expectedSourceRevision: 0,
      state: 'provider_deleted',
    }),
  )
  expect(erased).toBe(true)
}

function sweep() {
  const refreshRunRepo = createReviewRefreshRunRepository(db)
  const handler = createRefreshExpiringReviewsHandler({
    reviewRepo: createReviewRepository(db, () => NOW),
    discoveryRepo: createReviewDiscoveryRepository(db),
    refreshRunRepo,
    clock: () => NOW,
    logger: createMockLogger(),
  })
  return { refreshRunRepo, run: () => handler({} as never) }
}

const HOUR_MS = 60 * 60 * 1000
const LOOK_LATER = new Date(NOW.getTime() + 3 * HOUR_MS)

async function scheduleLook(
  nextLookAt: Date,
  failure?: Readonly<{ retryAt: Date }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO review_sync_state
       (property_id, source, next_incremental_at, error_class, error_retry_at,
        last_terminal_error_at, updated_at)
     VALUES ($1, 'google', $2, $3, $4, $5, $6)`,
    [
      PROPERTY,
      nextLookAt,
      failure ? 'provider_failure' : null,
      failure?.retryAt ?? null,
      failure ? new Date(NOW.getTime() - HOUR_MS) : null,
      NOW,
    ],
  )
}

/** A completed reconciliation of the Property's current epoch (a timestamp is all that is read). */
async function seedReconciliation(evaluatedAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO review_google_reputation_snapshot_facts
       (run_id, event_id, organization_id, property_id, source_epoch,
        review_count, average_rating, evaluated_at)
     VALUES ($1, $2, $3, $4, 0, 3, 4.5, $5)`,
    [
      '7e200000-0000-4000-8000-0000000000f1',
      '7e200000-0000-4000-8000-0000000000f2',
      ORG,
      PROPERTY,
      evaluatedAt,
    ],
  )
}

const syncState = async () =>
  (
    await pool.query(
      `SELECT next_incremental_at, error_class, error_retry_at
         FROM review_sync_state WHERE property_id = $1 AND source = 'google'`,
      [PROPERTY],
    )
  ).rows.at(0)

const erasedRows = [
  ['an erased row that kept its content clock', insertTombstoneKeepingItsClock],
  ['a row erased today', insertTombstoneErasedToday],
] as const

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await clean()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedTenant()
  await insertDueReview(LIVE_DUE, 'refresh-sweep-live-1', LOCATION)
  await insertDueReview(SECOND_LIVE_DUE, 'refresh-sweep-live-2', `${LOCATION}-b`)
})

describe.sequential('refresh-expiring-reviews moves the discovery schedule', () => {
  it('pulls the look forward when the last reconciliation is older than a day, and enqueues nothing', async () => {
    await scheduleLook(LOOK_LATER)
    await seedReconciliation(new Date(NOW.getTime() - 30 * HOUR_MS))
    const { refreshRunRepo, run } = sweep()

    await run()

    expect((await syncState())?.next_incremental_at).toEqual(NOW)
    expect(await refreshRunRepo.findLatestRun()).toMatchObject({
      status: 'completed',
      refreshDueCount: 2,
      enqueuedCount: 1,
      enqueueFailedCount: 0,
    })
  })

  it('pulls the look forward for a Property that never completed a reconciliation', async () => {
    await scheduleLook(LOOK_LATER)
    const { run } = sweep()

    await run()

    expect((await syncState())?.next_incremental_at).toEqual(NOW)
  })

  it('leaves the schedule alone when a reconciliation completed inside the day', async () => {
    await scheduleLook(LOOK_LATER)
    await seedReconciliation(new Date(NOW.getTime() - 2 * HOUR_MS))
    const { refreshRunRepo, run } = sweep()

    await run()

    expect((await syncState())?.next_incremental_at).toEqual(LOOK_LATER)
    expect(await refreshRunRepo.findLatestRun()).toMatchObject({
      status: 'completed',
      enqueuedCount: 0,
    })
  })

  it('does not pull a failure ahead of its backoff retry date', async () => {
    const retryAt = new Date(NOW.getTime() + 4 * HOUR_MS)
    await scheduleLook(retryAt, { retryAt })
    const { run } = sweep()

    await run()

    expect(await syncState()).toMatchObject({
      next_incremental_at: retryAt,
      error_class: 'provider_failure',
      error_retry_at: retryAt,
    })
  })
})

describe.sequential('refresh-expiring-reviews with a Review Google deleted', () => {
  it.each(erasedRows)(
    'completes and moves the schedule for the live rows behind %s',
    async (_label, plantTombstone) => {
      await scheduleLook(LOOK_LATER)
      await plantTombstone()
      const { refreshRunRepo, run } = sweep()

      await run()

      const latest = await refreshRunRepo.findLatestRun()
      expect(latest).toMatchObject({
        status: 'completed',
        candidatesSeen: 2,
        refreshDueCount: 2,
        enqueuedCount: 1,
        enqueueFailedCount: 0,
      })
      expect((await syncState())?.next_incremental_at).toEqual(NOW)
    },
  )

  it('keeps completing on every later run, not only the first', async () => {
    await insertTombstoneKeepingItsClock()
    const { run } = sweep()

    await run()
    await run()
    await run()

    const runs = await pool.query<{ status: string }>(
      'SELECT status FROM review_refresh_runs ORDER BY started_at',
    )
    expect(runs.rows.map((row) => row.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
  })
})
