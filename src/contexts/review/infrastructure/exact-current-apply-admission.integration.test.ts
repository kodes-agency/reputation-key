// A Review exact-current authority holds the source fence while the consumer
// (Inbox, for example) commits in its own transaction on a second pool client.
//
// On the closed beta (2026-09-29) the worker pool ran dry during a 244-review
// import: the fence holder waited up to 15 s for its second client while
// every other client sat in a transaction queued on the fence, and those all
// failed at the 10 s lock timeout. The authority now takes both clients before
// it takes the fence, so the holder never waits on the pool.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { reviewCreated } from '../domain/events'
import type { Review } from '../domain/types'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewResponseTargetAuthority } from './response-target-authority'
import { lockReviewSourceMutationScope } from './review-source-mutation-serialization'

const ORG = organizationId('org-review-exact-current-reservation')
const PROPERTY = propertyId('af200000-0000-4000-8000-000000000001')
const REVIEW = reviewId('af200000-0000-4000-8000-000000000002')
const OBSERVED_AT = new Date('2026-09-29T17:37:00.000Z')
const APPLICATION_NAME = 'rk-exact-current-reservation'
/** The worker's lock timeout is 10 s; a shorter one keeps a regression fast. */
const LOCK_TIMEOUT_MS = 1_000
const WAIT_LIMIT_MS = 5_000

let lease: TestLease
/** Two clients: exactly one exact-current unit's worth. */
let pool: Pool

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  const deadline = performance.now() + WAIT_LIMIT_MS
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error('condition never held')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Connections of the pool under test that are queued on a row lock. */
async function lockWaiters(): Promise<number> {
  const result = await lease.pool.query<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM pg_stat_activity
     WHERE application_name = $1 AND wait_event_type = 'Lock'`,
    [APPLICATION_NAME],
  )
  return result.rows[0]?.waiting ?? 0
}

/** SQLSTATE of a pg error, directly or behind Drizzle's query wrapper. */
function errorCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } }).cause
  const code = (error as { code?: unknown }).code ?? cause?.code
  return typeof code === 'string' ? code : 'unknown'
}

function review(): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'exact-current-reservation-review',
    externalLocationId: 'locations/exact-current-reservation',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    rating: 4,
    text: 'A review imported in a burst',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-09-01T12:00:00.000Z'),
    expiresAt: new Date('2027-09-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-09-01T12:00:00.000Z'),
    sourceUpdatedAt: null,
    firstFetchedAt: OBSERVED_AT,
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt: new Date('2026-10-29T12:00:00.000Z'),
    contentHash: 'exact-current-reservation-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 28,
    aiSourceDigest: 'b'.repeat(64),
  }
}

async function clean(): Promise<void> {
  for (const table of [
    'outbox_events',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
    'properties',
  ]) {
    await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 1)
  pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 2,
    application_name: APPLICATION_NAME,
    connectionTimeoutMillis: WAIT_LIMIT_MS,
    onConnect: (client) => client.query(`SET lock_timeout = ${LOCK_TIMEOUT_MS}`),
  })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await pool.end()
  await clean()
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.release()
  clearEventSchemas()
})

beforeEach(async () => {
  await clean()
  await seedOrgs(lease.pool, [ORG])
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Exact-current reservation', 'exact-current-reservation', 'UTC')`,
    [PROPERTY, ORG],
  )
  await createAtomicReviewCommandStore(drizzle(pool), () => OBSERVED_AT).upsertAndRecord(
    review(),
    (persisted) =>
      reviewCreated({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      }),
    OBSERVED_AT,
    'c'.repeat(64),
    'ongoing',
  )
})

describe('Review exact-current apply with the pool exhausted', () => {
  it.each([
    ['opens its transaction at once', false],
    // Inbox's source-transition and reply-observation consumers read the item
    // through the pool before their transaction.
    ['reads through the pool first', true],
  ])(
    'never holds the source fence while a consumer that %s waits for a client',
    async (_shape, readsFirst) => {
      const db = drizzle(pool)
      const fenceHeld = deferred()
      // A concurrent import in another job: it takes a pool client, then queues
      // on the same Property fence.
      const concurrentImport = (async () => {
        await fenceHeld.promise
        return db.transaction((tx) =>
          lockReviewSourceMutationScope(tx, {
            organizationId: ORG,
            propertyId: PROPERTY,
            reviewId: REVIEW,
            sourceEpoch: 0,
          }),
        )
      })().then(
        (current) => ({ current }),
        (error: unknown) => ({ error: errorCode(error) }),
      )

      let consumerWaitMs = Number.NaN
      const outcome = await createReviewResponseTargetAuthority(db).withExactCurrent(
        { organizationId: ORG, propertyId: PROPERTY, reviewId: REVIEW, sourceEpoch: 0 },
        async (permit) => {
          fenceHeld.resolve()
          await waitUntil(async () => pool.waitingCount > 0 || (await lockWaiters()) > 0)
          const started = performance.now()
          if (readsFirst) await db.execute(sql`SELECT 1`)
          // The consumer's own transaction, as Inbox opens one.
          await db.transaction((tx) => tx.execute(sql`SELECT 1`))
          consumerWaitMs = performance.now() - started
          return permit.materialReviewRevision
        },
      )

      expect(outcome).toEqual({ status: 'current', value: 1 })
      await expect(concurrentImport).resolves.toEqual({ current: true })
      expect(consumerWaitMs).toBeLessThan(LOCK_TIMEOUT_MS)
    },
  )
})
