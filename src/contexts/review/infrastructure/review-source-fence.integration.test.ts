// The Review source fence guards `properties.source_epoch` and nothing else.
//
// It is taken by every review import, Inbox projection and AI sequence
// allocation, so on the closed beta (2026-09-29) a 244-review import held it
// almost continuously. As `FOR UPDATE` it also blocked every foreign-key check
// against the Property: metric readings, AI settlements and notifications
// queued behind the import and failed at the 10 s lock timeout. The fence is
// `FOR NO KEY UPDATE`: foreign-key checks pass, and it still excludes every
// other fence holder and every epoch writer.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { lockReviewSourceMutationScope } from './review-source-mutation-serialization'

const ORG = organizationId('org-review-source-fence-mode')
const PROPERTY = propertyId('af100000-0000-4000-8000-000000000001')
const REVIEW = reviewId('af100000-0000-4000-8000-000000000002')
const PROPERTY_REVIEW_DASHBOARD_VERSION = '11111111-1111-4111-8111-111111111205'
/** Short enough to keep a regression fast, long enough for an unblocked insert. */
const PROBE_LOCK_TIMEOUT = '1s'
const LOCK_NOT_AVAILABLE = '55P03'

let lease: TestLease
let pool: Pool

type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type FenceHolder = Readonly<{ release: () => Promise<void> }>

/** Hold the fence in an open transaction until `release`. */
async function holdFence(
  take: (db: ReturnType<typeof drizzle>) => Promise<unknown>,
): Promise<FenceHolder> {
  const db = drizzle(pool)
  const held = deferred()
  const done = deferred()
  const transaction = db.transaction(async (tx) => {
    await take(tx as unknown as ReturnType<typeof drizzle>)
    held.resolve()
    await done.promise
  })
  // Surface a failure to take the fence instead of waiting forever.
  await Promise.race([held.promise, transaction])
  return {
    release: async () => {
      done.resolve()
      await transaction
    },
  }
}

const takeHelperFence = (db: ReturnType<typeof drizzle>) =>
  lockReviewSourceMutationScope(
    db as unknown as Parameters<typeof lockReviewSourceMutationScope>[0],
    { organizationId: ORG, propertyId: PROPERTY, reviewId: REVIEW, sourceEpoch: 0 },
  ).then((current) => {
    if (!current) throw new Error('fixture Property epoch moved')
  })

const takeSequenceFence = (db: ReturnType<typeof drizzle>) =>
  db.execute(sql`SELECT lock_review_ai_analysis_head_v1(${ORG}, ${PROPERTY}::uuid, 0)`)

/** Run one statement on its own connection under a short lock timeout. */
async function probe(statement: string, values: unknown[] = []): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL lock_timeout = '${PROBE_LOCK_TIMEOUT}'`)
    await client.query(statement, values)
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const insertMetricReading = () =>
  probe(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     ) VALUES ($1::uuid, $2, $3::uuid, NULL, 'property.review', 5::real,
               $4, $5, 'google_property_derivative', 5::numeric, 1, 'exact',
               NOW(), NOW(), '2026-09-29', 'exact', 'guest_gateway_metric')`,
    [
      randomUUID(),
      ORG,
      PROPERTY,
      PROPERTY_REVIEW_DASHBOARD_VERSION,
      `review-source-fence-${randomUUID()}`,
    ],
  )

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 1)
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
})

afterAll(async () => {
  await pool.end()
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.release()
})

beforeEach(async () => {
  await seedOrgs(lease.pool, [ORG])
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Review source fence', 'review-source-fence-mode', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

afterEach(async () => {
  await lease.pool.query(
    'DELETE FROM review_ai_analysis_heads WHERE organization_id = $1',
    [ORG],
  )
  await lease.pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG])
})

describe.each([
  ['the Review source-mutation helper', takeHelperFence],
  ['the analysis-sequence allocation', takeSequenceFence],
])('while %s holds the source fence', (_name, take) => {
  it('records a metric reading for the Property without waiting', async () => {
    const holder = await holdFence(take)
    try {
      await expect(insertMetricReading()).resolves.toBeUndefined()
    } finally {
      await holder.release()
    }
  })

  it.each([
    [
      'another sequence allocation',
      `SELECT lock_review_ai_analysis_head_v1($1, $2::uuid, 0)`,
    ],
    [
      'an explicit epoch writer lock',
      `SELECT source_epoch FROM properties WHERE organization_id = $1 AND id = $2::uuid FOR UPDATE`,
    ],
    [
      'another source fence',
      `SELECT source_epoch FROM properties WHERE organization_id = $1 AND id = $2::uuid FOR NO KEY UPDATE`,
    ],
    [
      'an epoch update',
      `UPDATE properties SET source_epoch = source_epoch + 1 WHERE organization_id = $1 AND id = $2::uuid`,
    ],
  ])('still excludes %s', async (_label, statement) => {
    const holder = await holdFence(take)
    try {
      await expect(probe(statement, [ORG, PROPERTY])).rejects.toMatchObject({
        code: LOCK_NOT_AVAILABLE,
      })
    } finally {
      await holder.release()
    }
  })
})
