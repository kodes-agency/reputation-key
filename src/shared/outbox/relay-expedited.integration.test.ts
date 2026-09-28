// An expedited event published behind a burst is dispatched before it. This
// suite proves, against a real BullMQ queue and worker, that the relay's
// `lifo` publication puts `identity.merchant_ai.changed` ahead of review events
// that were already waiting — the wait that delayed Review Analysis by about a
// minute during an import. And that a Review Analysis replay — one fact per
// eligible review, up to an import's 10,000 — does not jump ahead of the
// notification facts already waiting.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue, Worker } from 'bullmq'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import type {
  OutboxRepository,
  UnpublishedEvent,
} from './infrastructure/outbox-repository'
import { createOutboxRelay } from './relay'

// Suite-unique queue: the shared local Redis hosts other suites' queues.
const QUEUE = `relay-expedited-it-${randomUUID().slice(0, 8)}`
const WAIT = { timeout: 15_000, interval: 50 } as const

function event(id: string, eventType: string): UnpublishedEvent {
  return {
    id,
    eventType,
    eventVersion: 1,
    payload: {},
    organizationId: 'org-relay-expedited',
    propertyId: null,
    sourceContext: 'test',
    sourceAggregateId: id,
    recordedAt: new Date('2026-09-28T09:40:18.000Z'),
  }
}

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

describe('expedited dispatch (real BullMQ queue and worker)', () => {
  it('dispatches switching AI on before the review burst already waiting', async () => {
    const redis = lease?.redis
    if (!redis || !queue) return
    const burst = Array.from({ length: 5 }, (_, index) =>
      event(`evt-review-${index}`, 'review.created'),
    )
    const events = [...burst, event('evt-ai', 'identity.merchant_ai.changed')]
    const repo = {
      claimUnpublished: vi.fn(async () => events),
      markPublished: vi.fn(async () => {}),
      renewLease: vi.fn(async (ids: readonly string[]) => ids.length),
    } as unknown as OutboxRepository

    await createOutboxRelay(repo, queue, { relayId: 'relay-expedited-it' }).poll()

    const dispatched: string[] = []
    const worker = new Worker(
      QUEUE,
      async (job) => {
        dispatched.push(job.name)
      },
      {
        connection: redis as unknown as import('bullmq').ConnectionOptions,
        concurrency: 1,
      },
    )
    try {
      await vi.waitFor(() => expect(dispatched).toHaveLength(events.length), WAIT)
      expect(dispatched[0]).toBe('identity.merchant_ai.changed')
      expect(dispatched.slice(1)).toEqual(burst.map(() => 'review.created'))
    } finally {
      await worker.close()
    }
  })

  it('keeps a Review Analysis replay behind the notification facts already waiting', async () => {
    const redis = lease?.redis
    if (!redis || !queue) return
    const waiting = [
      event('evt-new-review', 'inbox.inbox_item.created'),
      event('evt-publish-failed', 'review.reply.publish_failed'),
    ]
    const replay = Array.from({ length: 5 }, (_, index) =>
      event(`evt-backfill-${index}`, 'ai.review_analysis.backfill_requested'),
    )
    const events = [...waiting, ...replay]
    const repo = {
      claimUnpublished: vi.fn(async () => events),
      markPublished: vi.fn(async () => {}),
      renewLease: vi.fn(async (ids: readonly string[]) => ids.length),
    } as unknown as OutboxRepository

    await createOutboxRelay(repo, queue, { relayId: 'relay-expedited-it' }).poll()

    const dispatched: string[] = []
    const worker = new Worker(
      QUEUE,
      async (job) => {
        dispatched.push(job.name)
      },
      {
        connection: redis as unknown as import('bullmq').ConnectionOptions,
        concurrency: 1,
      },
    )
    try {
      await vi.waitFor(() => expect(dispatched).toHaveLength(events.length), WAIT)
      expect(dispatched.slice(0, 2)).toEqual([
        'inbox.inbox_item.created',
        'review.reply.publish_failed',
      ])
    } finally {
      await worker.close()
    }
  })
})
