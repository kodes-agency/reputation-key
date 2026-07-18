// BQC-3.6 — failure quarantine + redrive against REAL Redis/BullMQ.
//
// Proves the quarantine queue mechanics end to end (add on exhaustion,
// content-safe envelope, redrive back to the original queue with metadata
// and a fresh attempt budget) with real BullMQ Queue instances — the unit
// suite covers the same logic with fakes.
//
// Skips cleanly when Redis is unreachable so environments without a Redis
// service still run the rest of the integration project.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Queue, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import {
  quarantineExhaustedJob,
  createRedriveJob,
  listQuarantinedJobs,
} from '#/shared/jobs/failure-quarantine'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const QUARANTINE = 'bqc36-it-quarantine'
const TARGET = 'bqc36-it-default'

let redis: Redis | undefined
let redisAvailable = false
let quarantineQueue: Queue | undefined
let targetQueue: Queue | undefined

async function obliterateQuietly(queue: Queue | undefined): Promise<void> {
  if (!queue) return
  try {
    await queue.obliterate({ force: true })
  } catch {
    // best-effort cleanup — the queue may not exist yet
  }
}

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 2000 })
  try {
    await redis.ping()
    redisAvailable = true
  } catch {
    redisAvailable = false
    return
  }
  const connection = redis as unknown as import('bullmq').ConnectionOptions
  quarantineQueue = new Queue(QUARANTINE, { connection })
  targetQueue = new Queue(TARGET, { connection })
  await obliterateQuietly(quarantineQueue)
  await obliterateQuietly(targetQueue)
})

afterAll(async () => {
  await obliterateQuietly(quarantineQueue)
  await obliterateQuietly(targetQueue)
  await quarantineQueue?.close()
  await targetQueue?.close()
  redis?.disconnect()
})

function exhaustedJob(): Job {
  return {
    id: 'it-orig-1',
    name: 'sync-property-reviews',
    queueName: 'default',
    data: { propertyId: 'prop-1', organizationId: 'org-1' },
    attemptsMade: 3,
    opts: { attempts: 3 },
  } as unknown as Job
}

describe('failure quarantine against real Redis (BQC-3.6)', () => {
  it('quarantines an exhausted job and redrives it back with metadata', async () => {
    if (!redisAvailable || !quarantineQueue || !targetQueue) return

    const result = await quarantineExhaustedJob(
      quarantineQueue,
      exhaustedJob(),
      new Error('provider timeout'),
    )
    expect(result.quarantined).toBe(true)

    const listed = await listQuarantinedJobs(quarantineQueue)
    expect(listed).toHaveLength(1)
    const entry = listed[0]!
    expect(entry.envelope.jobName).toBe('sync-property-reviews')
    expect(entry.envelope.originalQueue).toBe('default')
    expect(entry.envelope.failedReason).toBe('Error: provider timeout')

    const redrive = createRedriveJob(quarantineQueue, (name) =>
      name === 'default' ? targetQueue : undefined,
    )
    const redriven = await redrive(entry.quarantineJobId)
    expect(redriven.redriven).toBe(true)

    // Quarantine entry moved away.
    expect(await listQuarantinedJobs(quarantineQueue)).toHaveLength(0)

    // The redriven job sits on the original queue with metadata + fresh budget.
    const waiting = await targetQueue.getJobs(['waiting', 'delayed'])
    expect(waiting).toHaveLength(1)
    const job = waiting[0]!
    expect(job.name).toBe('sync-property-reviews')
    const data = job.data as Record<string, unknown>
    expect(data.propertyId).toBe('prop-1')
    const meta = data.redriveMetadata as Readonly<{
      redrivenFrom: string
      originalQuarantineId: string
    }>
    expect(meta.redrivenFrom).toBe('quarantine')
    expect(meta.originalQuarantineId).toBe(entry.quarantineJobId)
    expect(job.opts.attempts).toBe(jobEnqueueOptions('sync-property-reviews').attempts)
  })
})
