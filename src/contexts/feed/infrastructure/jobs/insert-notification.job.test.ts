import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NoticeWriter } from '../../notify/consumers.server'
import {
  createInsertNotificationDrainHandler,
  type InsertNotificationJobData,
} from './insert-notification.job'
import { createFakeJobLogger } from './test-fixtures'

const PROPERTY = '11111111-1111-4111-8111-111111111111'

const data: InsertNotificationJobData = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId(PROPERTY),
  type: 'feedback.created',
  resourceType: 'inbox_item',
  resourceId: 'item-1',
  eventId: 'event-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google' },
  audience: {
    kind: 'responsible_scope',
    scope: { kind: 'property', propertyId: PROPERTY },
  },
}

const delivery = {
  eventId: 'event-1',
  eventType: 'inbox.inbox_item.created',
  consumerName: 'notification.on-inbox-item-created',
  receiptKey: 'abc123',
}

const build = () => {
  const write = vi.fn<NoticeWriter['write']>(async () => 'applied')
  const handler = createInsertNotificationDrainHandler({
    noticeWriter: { write },
    logger: createFakeJobLogger(),
  })
  return { write, handler }
}

const run = (handler: ReturnType<typeof build>['handler'], job: unknown) =>
  handler({ data: job } as Job)

describe('insert-notification drain', () => {
  it('writes a queued delivery through the writer under the receipt its enqueue recorded', async () => {
    const { write, handler } = build()

    await run(handler, { ...data, delivery })

    const { audience, eventId: _eventId, ...notice } = data
    expect(write).toHaveBeenCalledWith({
      eventId: 'event-1',
      consumerName: 'notification.materialized:notification.on-inbox-item-created:abc123',
      status: 'applied',
      notices: [{ ...notice, audience }],
    })
  })

  it('never hands the delivery marker on as part of the notice', async () => {
    const { write, handler } = build()

    await run(handler, { ...data, delivery })

    expect(write.mock.calls[0]![0].notices[0]).not.toHaveProperty('delivery')
  })

  it('writes a job with no marker under a receipt of its own, the same for a redelivery', async () => {
    const { write, handler } = build()

    await run(handler, data)
    await run(handler, data)

    const [first, second] = write.mock.calls.map(([call]) => call.consumerName)
    expect(first).toMatch(/^notification\.drained:[0-9a-f]{32}$/)
    expect(second).toBe(first)
  })

  it('consumes a job queued before notices carried an audience, writing nothing', async () => {
    const { write, handler } = build()
    const { audience: _audience, ...legacy } = data

    await run(handler, legacy)

    expect(write).not.toHaveBeenCalled()
  })

  it('consumes a job whose audience is invalid, writing nothing', async () => {
    const { write, handler } = build()

    await run(handler, { ...data, audience: { kind: 'nobody' } })

    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a delivery marker that names another event', async () => {
    const { write, handler } = build()

    await expect(
      run(handler, { ...data, delivery: { ...delivery, eventId: 'event-2' } }),
    ).rejects.toThrow('invalid outbox delivery marker')
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a job missing its identity', async () => {
    const { write, handler } = build()

    await expect(run(handler, { ...data, userId: '' })).rejects.toThrow(
      'invalid insert-notification job',
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('lets a writer failure fail the job so it is retried', async () => {
    const { write, handler } = build()
    write.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(run(handler, { ...data, delivery })).rejects.toThrow(
      'database unavailable',
    )
  })
})
