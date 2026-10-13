// On-demand review analysis against a REAL BullMQ queue and worker.
//
// The job id is the review id, so repeated opens of one review coalesce into
// one waiting job. BullMQ ignores an add under an id it still holds, and it
// holds a failed job for as long as the job stays in its failed set. The family
// has one attempt, so a single failure (a timeout, a database error, a policy
// outage) is terminal. This suite fails one such job with a real worker and
// asks for the same review again.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue, Worker } from 'bullmq'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createAnalyzeReviewNowEnqueue } from './ai-job-enqueue'

// Suite-unique queue: the shared local Redis hosts other suites' queues.
const QUEUE = `ai-analysis-now-it-${randomUUID().slice(0, 8)}`
const WAIT = { timeout: 15_000, interval: 50 } as const
const REVIEW = {
  organizationId: 'ai-job-enqueue-it',
  propertyId: '71000000-0000-4000-8000-000000000601',
  reviewId: '71000000-0000-4000-8000-000000000602',
} as const

let lease: RedisTestLease | undefined
let queue: Queue | undefined

beforeAll(async () => {
  lease = await acquireRedisTestLease()
  if (!lease.redis) return
  queue = new Queue(QUEUE, {
    connection: lease.redis as unknown as import('bullmq').ConnectionOptions,
  })
})

afterAll(async () => {
  if (queue) {
    await queue.obliterate({ force: true })
    await queue.close()
  }
  lease?.release()
})

describe('on-demand review analysis (real BullMQ queue and worker)', () => {
  it('queues the next request for a review whose earlier job failed', async () => {
    const redis = lease?.redis
    if (!redis || !queue) return
    const enqueue = createAnalyzeReviewNowEnqueue(queue)
    await enqueue(REVIEW)

    const failed: string[] = []
    const worker = new Worker(
      QUEUE,
      async () => {
        throw new Error('provider timeout')
      },
      { connection: redis as unknown as import('bullmq').ConnectionOptions },
    )
    worker.on('failed', (job) => failed.push(job?.id ?? 'unknown'))
    try {
      await vi.waitFor(
        () => expect(failed).toEqual([`ai-analysis-now-${REVIEW.reviewId}`]),
        WAIT,
      )
    } finally {
      await worker.close()
    }

    // The manager opens the review again; the request path answers `queued`.
    await enqueue(REVIEW)

    await expect(queue.getJobCounts('waiting', 'failed')).resolves.toEqual({
      waiting: 1,
      failed: 0,
    })
  })

  it('still coalesces repeated requests while one is waiting', async () => {
    const redis = lease?.redis
    if (!redis || !queue) return
    await queue.drain()
    const enqueue = createAnalyzeReviewNowEnqueue(queue)

    await enqueue(REVIEW)
    await enqueue(REVIEW)

    await expect(queue.getJobCounts('waiting')).resolves.toEqual({ waiting: 1 })
  })
})
