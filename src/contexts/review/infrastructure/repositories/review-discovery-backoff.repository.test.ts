// Review context — discovery repository: failure backoff state and the
// content refresh's pull-forward (real PostgreSQL).
//
// `markDiscoveryDeferred` now also writes the time of the failure, and
// `findFailureState` reads it back, so the sync job can derive how long the
// previous failure waited (domain/snapshot-failure-backoff.ts).
// `pullLooksForward` is how the hourly refresh sweep moves a Property's next
// discovery look up instead of enqueueing a full sync of its own.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { snapshotFailureRetryMs } from '../../domain/snapshot-failure-backoff'
import { createReviewDiscoveryRepository } from './review-discovery.repository'

const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments

const ORG = 'org-discovery-backoff-11111111111111'
const CONNECTION = 'c2000000-0000-4000-8000-000000000001'
const PROP_CONNECTED = 'd2000000-0000-4000-8000-000000000001'
const PROP_CONNECTED_2 = 'd2000000-0000-4000-8000-000000000002'
const ALL_PROPS = [PROP_CONNECTED, PROP_CONNECTED_2]

const NOW = new Date('2026-10-21T12:00:00.000Z')
const PAGE = 500

let pool: Pool
const db = getDb()
let factSequence = 0

/**
 * A completed-run fact, as the snapshot repository writes it: timestamps only
 * matter here. `listingComplete = false` is a head fact (Google's numbers from
 * one read of its newest page), which proves no listing.
 */
async function seedFact(
  propertyId: string,
  sourceEpoch: number,
  evaluatedAt: Date,
  listingComplete = true,
): Promise<void> {
  factSequence++
  const suffix = String(factSequence).padStart(12, '0')
  await pool.query(
    `INSERT INTO review_google_reputation_snapshot_facts
       (run_id, event_id, organization_id, property_id, source_epoch,
        review_count, average_rating, evaluated_at, listing_complete)
     VALUES ($1, $2, $3, $4, $5, 3, 4.5, $6, $7)`,
    [
      `f3000000-0000-4000-8000-${suffix}`,
      `f4000000-0000-4000-8000-${suffix}`,
      ORG,
      propertyId,
      sourceEpoch,
      evaluatedAt,
      listingComplete,
    ],
  )
}

const syncState = async (propertyId: string) =>
  (
    await pool.query(
      `SELECT next_incremental_at, last_success_at, error_class, error_retry_at, updated_at
         FROM review_sync_state WHERE property_id = $1 AND source = 'google'`,
      [propertyId],
    )
  ).rows.at(0)

/** The sweep is tenant-cross: narrow to this suite's properties. */
const mine = (
  candidates: readonly Readonly<{ propertyId: string }>[],
): readonly string[] =>
  candidates.map((c) => c.propertyId).filter((id) => ALL_PROPS.includes(id))

async function clearSeed(): Promise<void> {
  await pool.query(
    `DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = $1`,
    [ORG],
  )
  await pool.query(`DELETE FROM review_sync_state WHERE property_id = ANY($1)`, [
    ALL_PROPS,
  ])
  await pool.query(`DELETE FROM properties WHERE organization_id = $1`, [ORG])
  await pool.query(`DELETE FROM google_connections WHERE organization_id = $1`, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Discovery Backoff Test Org', 'discovery-backoff-test-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
})

afterAll(async () => {
  await clearSeed()
  await deleteTestOrganizations(pool, [ORG])
  await pool.end()
})

beforeEach(async () => {
  await clearSeed()
  await pool.query(
    `INSERT INTO google_connections
       (id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status, credential_use_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'enc-a', 'enc-r', NOW() + INTERVAL '1 day',
             ARRAY['https://www.googleapis.com/auth/business.manage'],
             'seed-user', 'organization', 'active', 'active', NOW(), NOW())`,
    [CONNECTION, ORG, `subject-${CONNECTION}`],
  )
  for (const id of ALL_PROPS) {
    await pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, google_connection_id,
          gbp_account_id, gbp_location_id, google_binding_state, lifecycle_state,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, $6, $7, 'active', 'active', NOW(), NOW())`,
      [
        id,
        ORG,
        `Backoff ${id.slice(-2)}`,
        `backoff-${id.slice(-2)}`,
        CONNECTION,
        GBP_ACCOUNT_ID,
        `${GBP_LOCATION_ID}-${id.slice(-2)}`,
      ],
    )
  }
})

describe('reviewDiscoveryRepository failure backoff and pull-forward (integration)', () => {
  describe('failure backoff', () => {
    const MINUTE_MS = 60 * 1000
    const HOUR_MS = 60 * MINUTE_MS
    const BASE_MS = 15 * MINUTE_MS

    /** One failed snapshot run, as the sync job records it. Returns the wait it chose. */
    async function failAt(at: Date, errorClass = 'provider_failure'): Promise<number> {
      const repo = createReviewDiscoveryRepository(db)
      const waitMs = snapshotFailureRetryMs({
        previous: await repo.findFailureState(PROP_CONNECTED),
        now: at,
        baseIntervalMs: BASE_MS,
        locationTooLarge: false,
      })
      await repo.markDiscoveryDeferred(
        PROP_CONNECTED,
        at,
        new Date(at.getTime() + waitMs),
        errorClass as 'provider_failure',
      )
      return waitMs
    }

    it('has no failure state for a property that has no sync state row', async () => {
      const repo = createReviewDiscoveryRepository(db)

      expect(await repo.findFailureState(PROP_CONNECTED)).toBeNull()
    })

    it('records when the failure happened next to its retry date', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const retryAt = new Date(NOW.getTime() + BASE_MS)

      await repo.markDiscoveryDeferred(PROP_CONNECTED, NOW, retryAt, 'provider_failure')

      expect(await repo.findFailureState(PROP_CONNECTED)).toEqual({
        errorClass: 'provider_failure',
        failedAt: NOW,
        retryAt,
      })
    })

    it('escalates the wait across three consecutive failures and starts over after a completed run', async () => {
      const repo = createReviewDiscoveryRepository(db)
      let at = NOW
      const waits: number[] = []

      for (let failure = 0; failure < 3; failure++) {
        const waitMs = await failAt(at)
        waits.push(waitMs)
        // The retry comes due and fails again.
        at = new Date(at.getTime() + waitMs)
      }
      expect(waits).toEqual([15 * MINUTE_MS, HOUR_MS, 4 * HOUR_MS])

      await repo.markSyncSucceeded(PROP_CONNECTED)
      expect((await repo.findFailureState(PROP_CONNECTED))?.errorClass).toBeNull()

      expect(await failAt(at)).toBe(15 * MINUTE_MS)
    })

    it('keeps the next look and the retry date equal, and out of the due set until then', async () => {
      const repo = createReviewDiscoveryRepository(db)
      await failAt(NOW)
      const second = await failAt(new Date(NOW.getTime() + BASE_MS))
      const retryAt = new Date(NOW.getTime() + BASE_MS + second)

      const state = await syncState(PROP_CONNECTED)
      expect(state?.next_incremental_at).toEqual(retryAt)
      expect(state?.error_retry_at).toEqual(retryAt)

      const justBefore = new Date(retryAt.getTime() - 1)
      expect(mine(await repo.findDuePropertiesBatch(justBefore, null, PAGE))).toEqual([
        PROP_CONNECTED_2,
      ])
      expect(mine(await repo.findDuePropertiesBatch(retryAt, null, PAGE))).toEqual([
        PROP_CONNECTED,
        PROP_CONNECTED_2,
      ])
    })
  })

  describe('pullLooksForward', () => {
    const HOUR_MS = 60 * 60 * 1000
    const DAY_MS = 24 * HOUR_MS
    const reconciledSince = new Date(NOW.getTime() - DAY_MS)

    const scheduleAt = (propertyId: string, nextDueAt: Date) =>
      pool.query(
        `INSERT INTO review_sync_state (property_id, source, next_incremental_at, updated_at)
         VALUES ($1, 'google', $2, $3)`,
        [propertyId, nextDueAt, new Date(NOW.getTime() - HOUR_MS)],
      )
    const nextLook = async (propertyId: string) =>
      (await syncState(propertyId))?.next_incremental_at

    it('moves the next look up to now when the last reconciliation is older than a day', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const later = new Date(NOW.getTime() + 5 * HOUR_MS)
      await scheduleAt(PROP_CONNECTED, later)
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - 30 * HOUR_MS))

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result).toEqual({ pulledForward: 1, skippedRecent: 0, skippedBackoff: 0 })
      expect(await nextLook(PROP_CONNECTED)).toEqual(NOW)
      expect(mine(await repo.findDuePropertiesBatch(NOW, null, PAGE))).toContain(
        PROP_CONNECTED,
      )
    })

    it('moves the look of a Property that has never completed a reconciliation', async () => {
      const repo = createReviewDiscoveryRepository(db)
      await scheduleAt(PROP_CONNECTED, new Date(NOW.getTime() + 5 * HOUR_MS))

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result.pulledForward).toBe(1)
      expect(await nextLook(PROP_CONNECTED)).toEqual(NOW)
    })

    it('leaves a Property alone when a reconciliation completed inside the day', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const later = new Date(NOW.getTime() + 5 * HOUR_MS)
      await scheduleAt(PROP_CONNECTED, later)
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - 2 * HOUR_MS))

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result).toEqual({ pulledForward: 0, skippedRecent: 1, skippedBackoff: 0 })
      expect(await nextLook(PROP_CONNECTED)).toEqual(later)
    })

    it('does not count a recent head fact as a reconciliation: it proves no listing', async () => {
      const repo = createReviewDiscoveryRepository(db)
      await scheduleAt(PROP_CONNECTED, new Date(NOW.getTime() + 5 * HOUR_MS))
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - 30 * HOUR_MS))
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - HOUR_MS), false)

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result).toEqual({ pulledForward: 1, skippedRecent: 0, skippedBackoff: 0 })
      expect(await nextLook(PROP_CONNECTED)).toEqual(NOW)
    })

    it('still leaves a Property alone when a completed listing is recent next to a newer head fact', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const later = new Date(NOW.getTime() + 5 * HOUR_MS)
      await scheduleAt(PROP_CONNECTED, later)
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - 3 * HOUR_MS))
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - HOUR_MS), false)

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result).toEqual({ pulledForward: 0, skippedRecent: 1, skippedBackoff: 0 })
      expect(await nextLook(PROP_CONNECTED)).toEqual(later)
    })

    it('ignores a recent reconciliation of an earlier source epoch', async () => {
      const repo = createReviewDiscoveryRepository(db)
      await pool.query(`UPDATE properties SET source_epoch = 1 WHERE id = $1`, [
        PROP_CONNECTED,
      ])
      await scheduleAt(PROP_CONNECTED, new Date(NOW.getTime() + 5 * HOUR_MS))
      await seedFact(PROP_CONNECTED, 0, new Date(NOW.getTime() - HOUR_MS))

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result.pulledForward).toBe(1)
    })

    it('does not pull a failure ahead of its backoff retry date, and keeps its failure state', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const retryAt = new Date(NOW.getTime() + 4 * HOUR_MS)
      await repo.markDiscoveryDeferred(PROP_CONNECTED, NOW, retryAt, 'provider_failure')

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result).toEqual({ pulledForward: 0, skippedRecent: 0, skippedBackoff: 1 })
      expect(await syncState(PROP_CONNECTED)).toMatchObject({
        next_incremental_at: retryAt,
        error_class: 'provider_failure',
        error_retry_at: retryAt,
      })
    })

    it('pulls a failure whose retry date has passed and leaves its failure state', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const past = new Date(NOW.getTime() - HOUR_MS)
      await repo.markDiscoveryDeferred(PROP_CONNECTED, past, past, 'provider_failure')
      await repo.markDiscoveryScheduled(
        PROP_CONNECTED,
        past,
        new Date(NOW.getTime() + HOUR_MS),
      )

      const result = await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect(result.pulledForward).toBe(1)
      expect(await syncState(PROP_CONNECTED)).toMatchObject({
        next_incremental_at: NOW,
        error_class: 'provider_failure',
        error_retry_at: past,
      })
    })

    it('writes nothing for a Property with no sync state row or a look already due', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const due = new Date(NOW.getTime() - HOUR_MS)
      await scheduleAt(PROP_CONNECTED_2, due)

      const result = await repo.pullLooksForward(
        [PROP_CONNECTED, PROP_CONNECTED_2],
        NOW,
        reconciledSince,
      )

      expect(result).toEqual({ pulledForward: 0, skippedRecent: 0, skippedBackoff: 0 })
      expect(await syncState(PROP_CONNECTED)).toBeUndefined()
      expect(await nextLook(PROP_CONNECTED_2)).toEqual(due)
    })

    it('leaves the success stamp alone: nothing was synced', async () => {
      const repo = createReviewDiscoveryRepository(db)
      const stampedAt = new Date(NOW.getTime() - 3 * HOUR_MS)
      await repo.markDiscoveryScheduled(
        PROP_CONNECTED,
        stampedAt,
        new Date(NOW.getTime() + 5 * HOUR_MS),
      )

      await repo.pullLooksForward([PROP_CONNECTED], NOW, reconciledSince)

      expect((await syncState(PROP_CONNECTED))?.last_success_at).toEqual(stampedAt)
    })

    it('does nothing for an empty list', async () => {
      const repo = createReviewDiscoveryRepository(db)

      expect(await repo.pullLooksForward([], NOW, reconciledSince)).toEqual({
        pulledForward: 0,
        skippedRecent: 0,
        skippedBackoff: 0,
      })
    })
  })
})
