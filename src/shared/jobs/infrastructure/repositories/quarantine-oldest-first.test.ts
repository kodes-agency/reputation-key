// The dead-letter quarantine read OLDEST-first, against REAL BullMQ.
//
// BullMQ LPUSHes the wait list, so a default `getJobs` page is the newest
// entries. Every quarantine read here is bounded (100-entry pages), which made
// each of them blind to an aged dead letter sitting behind a full page of
// fresh ones: the age alerts measured the newest page, the operator listing
// could not show (or redrive) the aged entry, and the TTL sweep stopped on an
// all-fresh newest page. Redrive and discard now look their target up by id,
// so the newest entry stays reachable off the oldest-first page. The unit suites fake the ordering; this suite proves
// it against the real Lua scripts with more entries than any one page holds.
//
// Redis discipline per the lease contract: a suite-unique queue name, and
// obliterate only ever targets that name. An unreachable LOCAL Redis skips.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Queue } from 'bullmq'
import { getDb } from '#/shared/db'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { findQuarantinedJob, listQuarantinedJobs } from '#/shared/jobs/failure-quarantine'
import { createQuarantineTtlSweepHandler } from '#/shared/jobs/quarantine-ttl-sweep.job'

const QUEUE = `quarantine-oldest-first-${randomUUID()}`
const DAY_MS = 24 * 60 * 60 * 1000
const AGED_COUNT = 5
const FRESH_COUNT = 150

let redisLease: RedisTestLease | undefined
let queue: Queue | undefined
let newestId: string | undefined

/** A parseable, content-free quarantine envelope quarantined `ageMs` ago. */
function envelope(originalJobId: string, ageMs: number) {
  return {
    originalQueue: 'default',
    originalJobId,
    jobName: 'insert-notification',
    data: { redacted: true },
    failedReason: 'Error: database unavailable',
    attemptsMade: 3,
    quarantinedAt: new Date(Date.now() - ageMs).toISOString(),
    publicationState: 'confirmed_failed',
  }
}

beforeAll(async () => {
  redisLease = await acquireRedisTestLease()
  const redis = redisLease.redis
  if (!redisLease.available || !redis) return
  queue = new Queue(QUEUE, {
    connection: redis as unknown as import('bullmq').ConnectionOptions,
  })
  // The aged entries land FIRST, then more fresh ones than a page holds —
  // the failover-then-burst shape that hid them.
  const aged = await queue.addBulk(
    Array.from({ length: AGED_COUNT }, (_, i) => ({
      name: 'insert-notification',
      data: envelope(`aged-${i}`, 40 * DAY_MS),
    })),
  )
  // The TTL sweep ages entries by BullMQ's own creation timestamp.
  for (const job of aged) {
    await redis.hset(
      `bull:${QUEUE}:${job.id as string}`,
      'timestamp',
      String(Date.now() - 40 * DAY_MS),
    )
  }
  const fresh = await queue.addBulk(
    Array.from({ length: FRESH_COUNT }, (_, i) => ({
      name: 'insert-notification',
      data: envelope(`fresh-${i}`, 60_000),
    })),
  )
  newestId = fresh.at(-1)?.id
})

afterAll(async () => {
  try {
    await queue?.obliterate({ force: true })
  } finally {
    await queue?.close()
    redisLease?.release()
  }
})

describe.sequential('dead-letter quarantine reads oldest-first (real BullMQ)', () => {
  it('ages the quarantine metric by the aged entry behind 150 fresh ones', async () => {
    if (!queue) return

    const snapshot = await createHealthChecker(getDb(), undefined, {
      quarantineQueue: queue,
    }).check()

    expect(snapshot.quarantine?.count).toBe(AGED_COUNT + FRESH_COUNT)
    expect(snapshot.quarantine?.oldestAgeMs).toBeGreaterThanOrEqual(40 * DAY_MS)
  })

  it('lists the aged entries first so an operator can reach them', async () => {
    if (!queue) return

    const listed = await listQuarantinedJobs(queue)

    expect(listed).toHaveLength(100)
    expect(
      listed.slice(0, AGED_COUNT).map((entry) => entry.envelope.originalJobId),
    ).toEqual(Array.from({ length: AGED_COUNT }, (_, i) => `aged-${i}`))
  })

  it('still reaches the newest entry for redrive or discard, off the oldest-first page', async () => {
    if (!queue || !newestId) return

    const listed = await listQuarantinedJobs(queue)
    const found = await findQuarantinedJob(queue, newestId)

    expect(listed.map((entry) => entry.quarantineJobId)).not.toContain(newestId)
    expect(found).toMatchObject({
      quarantineJobId: newestId,
      envelope: { originalJobId: `fresh-${FRESH_COUNT - 1}` },
    })
  })

  it('removes the expired entries instead of stopping at an all-fresh newest page', async () => {
    if (!queue) return

    const result = await createQuarantineTtlSweepHandler({
      queue,
      clock: () => new Date(),
      ttlMs: 30 * DAY_MS,
    })({} as never)

    expect(result).toMatchObject({ removed: AGED_COUNT, skipped: 0, capped: false })
    expect(await queue.getWaitingCount()).toBe(FRESH_COUNT)
  })
})
