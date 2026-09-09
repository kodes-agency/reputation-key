import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from './infrastructure/outbox-repository'
import {
  createPublishedEventRedeliveryHandler,
  type PublishedEventRedeliveryQueue,
} from '#/shared/outbox/published-event-redelivery.job'

const db = getDb()
const repo = createOutboxRepository(db)
const EVENT_TYPE = 'test.published-redelivery'
const CONSUMER = 'test.redelivery-consumer'
const NOW = new Date('2026-09-10T12:00:00.000Z')
const HOUR = 60 * 60 * 1_000

async function clean(): Promise<void> {
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
}

async function insertPublishedEvent(publishedAt: Date): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      event_type,
      event_version,
      payload,
      organization_id,
      source_context,
      source_aggregate_id,
      created_at,
      published_at
    ) VALUES (
      ${EVENT_TYPE},
      1,
      '{"resourceId":"redelivery-fixture"}'::jsonb,
      'org-redelivery-test',
      'test',
      'aggregate-redelivery-test',
      ${new Date(publishedAt.getTime() - 1_000)},
      ${publishedAt}
    )
    RETURNING id
  `)
  const row = result.rows[0]
  if (!row || typeof row.id !== 'string') throw new Error('fixture insert returned no id')
  return row.id
}

async function redeliveryState(eventId: string): Promise<{
  attempts: number
  nextAtMs: number | null
}> {
  const result = await db.execute(sql`
    SELECT consumer_redelivery_attempts AS attempts,
           (EXTRACT(EPOCH FROM consumer_redelivery_next_at) * 1000)::float8
             AS "nextAtMs"
    FROM outbox_events
    WHERE id = ${eventId}::uuid
  `)
  const row = result.rows[0]
  if (
    !row ||
    typeof row.attempts !== 'number' ||
    (row.nextAtMs !== null && typeof row.nextAtMs !== 'number')
  ) {
    throw new Error('redelivery state row malformed')
  }
  return { attempts: row.attempts, nextAtMs: row.nextAtMs }
}
function queueRecorder(): {
  queue: PublishedEventRedeliveryQueue
  added: Array<{ name: string; data: unknown; options: unknown }>
} {
  const added: Array<{ name: string; data: unknown; options: unknown }> = []
  return {
    added,
    queue: {
      add: vi.fn(async (name, data, options) => {
        added.push({ name, data, options })
        return undefined
      }),
    },
  }
}

beforeEach(clean)
afterAll(clean)

describe('published event redelivery', () => {
  it('redelivers only stale events missing a registered consumer receipt and stops at the attempt cap', async () => {
    const stranded = await insertPublishedEvent(new Date(NOW.getTime() - 3 * HOUR))
    const receipted = await insertPublishedEvent(new Date(NOW.getTime() - 3 * HOUR))
    const fresh = await insertPublishedEvent(new Date(NOW.getTime() - HOUR))
    await repo.insertReceipt(receipted, CONSUMER, 'applied')

    let currentTime = NOW
    const { queue, added } = queueRecorder()
    const handler = createPublishedEventRedeliveryHandler({
      repo,
      queue,
      clock: () => currentTime,
      logger: { info: vi.fn(), warn: vi.fn() },
      consumerExpectations: [{ eventType: EVENT_TYPE, consumerName: CONSUMER }],
      config: {
        batchSize: 10,
        horizonMs: 2 * HOUR,
        maxAttempts: 3,
        backoffBaseMs: HOUR,
      },
    })

    await handler({} as Job)

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      name: EVENT_TYPE,
      data: { eventId: stranded, eventType: EVENT_TYPE },
      options: { jobId: `${stranded}-redelivery-1` },
    })
    expect(await redeliveryState(stranded)).toEqual({
      attempts: 1,
      nextAtMs: NOW.getTime() + HOUR,
    })
    expect(await redeliveryState(receipted)).toEqual({ attempts: 0, nextAtMs: null })
    expect(await redeliveryState(fresh)).toEqual({ attempts: 0, nextAtMs: null })
    // Keep this fixture healthy after proving the horizon boundary so the
    // later fast-forward isolates the stranded row's retry budget.
    await repo.insertReceipt(fresh, CONSUMER, 'applied')

    // The durable next-at fence prevents the five-minute sweep from enqueueing
    // a second copy while this dispatch still owns its finite retry budget.
    await handler({} as Job)
    expect(added).toHaveLength(1)

    currentTime = new Date(NOW.getTime() + HOUR)
    await handler({} as Job)
    currentTime = new Date(NOW.getTime() + 3 * HOUR)
    await handler({} as Job)
    currentTime = new Date(NOW.getTime() + 8 * HOUR)
    await handler({} as Job)

    expect(added.map((entry) => entry.options)).toEqual([
      expect.objectContaining({ jobId: `${stranded}-redelivery-1` }),
      expect.objectContaining({ jobId: `${stranded}-redelivery-2` }),
      expect.objectContaining({ jobId: `${stranded}-redelivery-3` }),
    ])
    expect(await redeliveryState(stranded)).toMatchObject({ attempts: 3 })
  })
})
