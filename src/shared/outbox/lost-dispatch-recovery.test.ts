// Queue Redis is disposable (ADR 0053): a restart without persistence, or a
// failover to an empty replica, drops every waiting and retrying dispatch job.
// Their outbox rows are already published, so the relay never looks at them
// again, and the redelivery sweep waits two hours before it does. Recovery
// puts back exactly the jobs Redis no longer has.

import { describe, expect, it, vi } from 'vitest'
import type { UnpublishedEvent } from './infrastructure/outbox-repository'
import {
  republishLostDispatches,
  type PublishedAwaitingReceipt,
} from './lost-dispatch-recovery'

const NOW = new Date('2026-09-28T12:00:00.000Z')

function published(id: string, minutesAgo: number): PublishedAwaitingReceipt {
  const event: UnpublishedEvent = {
    id,
    eventType: 'inbox.inbox_item.created',
    eventVersion: 1,
    payload: {},
    organizationId: 'org-1',
    propertyId: null,
    sourceContext: 'inbox',
    sourceAggregateId: id,
    recordedAt: new Date(NOW.getTime() - minutesAgo * 60_000 - 1_000),
  }
  return { ...event, publishedAt: new Date(NOW.getTime() - minutesAgo * 60_000) }
}

function harness(pages: PublishedAwaitingReceipt[][], stillQueued: readonly string[]) {
  const read = vi.fn(async (_input: unknown) => pages.shift() ?? [])
  const add = vi.fn(async (_name: string, _data: unknown, _options: unknown) => undefined)
  const getJob = vi.fn(async (id: string) =>
    stillQueued.includes(id) ? { id } : undefined,
  )
  const logger = { info: vi.fn(), warn: vi.fn() }
  const run = (pageSize = 50) =>
    republishLostDispatches({
      readPublishedAwaitingReceipts: read,
      queue: { add, getJob },
      clock: () => NOW,
      logger,
      consumerExpectations: [
        {
          eventType: 'inbox.inbox_item.created',
          consumerName: 'notification.on-inbox-item-created',
        },
      ],
      config: { windowMs: 2 * 60 * 60_000, pageSize, maxEvents: 1_000 },
    })
  return { read, add, getJob, logger, run }
}

describe('lost dispatch recovery', () => {
  it('republishes a published fact whose job Redis no longer has, under its own id', async () => {
    const { add, run } = harness(
      [[published('evt-lost', 20), published('evt-queued', 10)]],
      ['evt-queued'],
    )

    const result = await run()

    expect(result).toEqual({ checked: 2, republished: 1, failures: 0 })
    expect(add).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledWith(
      'inbox.inbox_item.created',
      expect.objectContaining({ eventId: 'evt-lost' }),
      expect.objectContaining({ jobId: 'evt-lost', attempts: 8 }),
    )
  })

  it('reads the window page by page from where the last page ended', async () => {
    const first = [published('evt-1', 90), published('evt-2', 80)]
    const { read, add, run } = harness([first, [published('evt-3', 5)]], [])

    const result = await run(2)

    expect(result.republished).toBe(3)
    expect(add).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0]![0]).toMatchObject({
      publishedAfter: new Date(NOW.getTime() - 2 * 60 * 60_000),
      after: null,
      limit: 2,
    })
    expect(read.mock.calls[1]![0]).toMatchObject({
      after: { publishedAt: first[1]!.publishedAt, id: 'evt-2' },
    })
  })

  it('counts a failed add and carries on with the rest', async () => {
    const { add, logger, run } = harness(
      [[published('evt-a', 30), published('evt-b', 20)]],
      [],
    )
    add.mockRejectedValueOnce(new Error('connection lost'))

    const result = await run()

    expect(result).toEqual({ checked: 2, republished: 1, failures: 1 })
    expect(logger.warn).toHaveBeenCalled()
  })
})
