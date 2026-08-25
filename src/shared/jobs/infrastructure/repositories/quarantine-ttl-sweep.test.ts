// BQC-7.8 — quarantine TTL sweep integration proof (real Redis + PostgreSQL).
//
// The unit suite (src/shared/jobs/quarantine-ttl-sweep.job.test.ts) pins the
// paging/cap/skip semantics against a fake queue; this suite proves the sweep
// against REAL BullMQ: an entry whose creation timestamp is older than the
// TTL is removed via job.remove() (never obliterate/clean), a fresh entry
// survives, and the retention_runs evidence row (subject 'quarantine.ttl')
// lands with the real counts.
//
// Redis discipline per the lease contract: a suite-unique queue name;
// obliterate only ever targets that name. An unreachable LOCAL Redis skips
// cleanly (redisAvailable=false).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { getDb } from '#/shared/db'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import {
  createQuarantineTtlSweepHandler,
  QUARANTINE_TTL_SUBJECT,
} from '#/shared/jobs/quarantine-ttl-sweep.job'

const QUEUE = 'bqc78-it-quarantine-ttl'
const DAY_MS = 24 * 60 * 60 * 1000

const db = getDb()

let redisLease: RedisTestLease | undefined
let redisAvailable = false
let queue: Queue | undefined

async function obliterateQuietly(q: Queue | undefined): Promise<void> {
  if (!q) return
  try {
    await q.obliterate({ force: true })
  } catch {
    // best-effort cleanup — the queue may not exist yet
  }
}

/** Backdate a job's BullMQ creation timestamp (the sweep's age source). */
async function backdate(jobId: string, ageMs: number): Promise<void> {
  const redis = redisLease?.redis
  if (!redis) throw new Error('redis unavailable')
  await redis.hset(`bull:${QUEUE}:${jobId}`, 'timestamp', String(Date.now() - ageMs))
}

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM retention_runs WHERE subject = ${QUARANTINE_TTL_SUBJECT}`,
  )
  redisLease = await acquireRedisTestLease()
  redisAvailable = redisLease.available
  const redis = redisLease.redis
  if (!redisAvailable || !redis) return
  queue = new Queue(QUEUE, {
    connection: redis as unknown as import('bullmq').ConnectionOptions,
  })
  await obliterateQuietly(queue)
})

afterAll(async () => {
  await obliterateQuietly(queue)
  await queue?.close()
  redisLease?.release()
  await db.execute(
    sql`DELETE FROM retention_runs WHERE subject = ${QUARANTINE_TTL_SUBJECT}`,
  )
})

describe('quarantine TTL sweep (BQC-7.8, integration)', () => {
  it('removes the expired entry via job.remove(), keeps the fresh one, writes evidence', async () => {
    if (!redisAvailable || !queue) return

    const expired = await queue.add('sync-property-reviews', {
      propertyId: 'prop-1',
      organizationId: 'org-1',
    })
    const fresh = await queue.add('sync-property-reviews', {
      propertyId: 'prop-2',
      organizationId: 'org-1',
    })
    await backdate(expired.id as string, 40 * DAY_MS)

    const handler = createQuarantineTtlSweepHandler({
      queue,
      clock: () => new Date(),
      ttlMs: 30 * DAY_MS,
      db,
    })
    const result = await handler({} as never)

    expect(result).toMatchObject({ removed: 1, skipped: 0, capped: false })
    expect(await queue.getJob(expired.id as string)).toBeUndefined()
    expect(await queue.getJob(fresh.id as string)).toBeDefined()

    const evidence = await db.execute(
      sql`SELECT outcome, rows_deleted, policy_version FROM retention_runs
          WHERE subject = ${QUARANTINE_TTL_SUBJECT}
          ORDER BY started_at DESC LIMIT 1`,
    )
    expect(evidence.rows).toHaveLength(1)
    expect(evidence.rows[0]).toMatchObject({ outcome: 'completed' })
    expect(Number(evidence.rows[0].rows_deleted)).toBe(1)
    // RETENTION_POLICY_VERSION 4 (+ terminal notification-digest retention).
    expect(Number(evidence.rows[0].policy_version)).toBe(4)
  })
})
