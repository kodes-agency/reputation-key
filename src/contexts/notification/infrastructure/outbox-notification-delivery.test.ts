import { describe, expect, it, vi } from 'vitest'
import {
  parseOutboxNotificationDelivery,
  withBetaOutboxNotificationDelivery,
  withOutboxNotificationDelivery,
} from './outbox-notification-delivery'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../application/beta-notification-trigger-matrix'

const DATA = {
  userId: 'manager-1',
  organizationId: 'org-1',
  propertyId: '81000000-0000-4000-8000-000000000001',
  type: 'inbox.assigned' as const,
  resourceType: 'inbox_item' as const,
  resourceId: '81000000-0000-4000-8000-000000000002',
  eventId: '81000000-0000-4000-8000-000000000003',
  payload: {},
  audience: {
    kind: 'inbox_assignee' as const,
    inboxItemId: '81000000-0000-4000-8000-000000000002',
  },
}

describe('outbox notification delivery bridge', () => {
  it('records durable enqueue evidence only after Redis accepts the job', async () => {
    const calls: string[] = []
    const add = vi.fn(async (_name: string, data: unknown) => {
      calls.push('redis')
      return data
    })
    const insertReceipt = vi.fn(async () => {
      calls.push('postgres')
    })
    const queue = withOutboxNotificationDelivery(
      { add },
      { insertReceipt },
      {
        eventType: 'inbox.inbox_item.assigned',
        consumerName: 'notification.on-inbox-inbox_item-assigned',
      },
    )

    await queue.add('insert-notification', DATA, { jobId: 'stable-job' })

    expect(calls).toEqual(['redis', 'postgres'])
    const queued = add.mock.calls[0]![1]
    const delivery = parseOutboxNotificationDelivery(queued)
    expect(delivery).toEqual(
      expect.objectContaining({
        eventId: DATA.eventId,
        eventType: 'inbox.inbox_item.assigned',
        consumerName: 'notification.on-inbox-inbox_item-assigned',
      }),
    )
    expect(insertReceipt).toHaveBeenCalledWith(
      DATA.eventId,
      delivery!.enqueueReceiptName,
      'applied',
    )
  })

  it('does not claim enqueue evidence when Redis rejects the job', async () => {
    const insertReceipt = vi.fn(async () => {})
    const queue = withOutboxNotificationDelivery(
      { add: vi.fn(async () => Promise.reject(new Error('redis unavailable'))) },
      { insertReceipt },
      {
        eventType: 'inbox.inbox_item.assigned',
        consumerName: 'notification.on-inbox-inbox_item-assigned',
      },
    )

    await expect(queue.add('insert-notification', DATA)).rejects.toThrow(
      'redis unavailable',
    )
    expect(insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects tampered delivery evidence instead of settling another event', () => {
    const delivery = {
      eventId: DATA.eventId,
      eventType: 'inbox.inbox_item.assigned',
      consumerName: 'notification.on-inbox-inbox_item-assigned',
      receiptKey: 'tampered',
    }

    expect(parseOutboxNotificationDelivery({ ...DATA, delivery })).toBeNull()
  })

  it('derives the one active durable route from the notification type', async () => {
    let queued: unknown
    const insertReceipt = vi.fn(async () => {})
    const queue = withBetaOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt },
    )

    await queue.add('insert-notification', DATA)

    expect(parseOutboxNotificationDelivery(queued)).toEqual(
      expect.objectContaining({
        eventType: 'inbox.inbox_item.assigned',
        consumerName: 'notification.on-inbox-inbox_item-assigned',
      }),
    )
    expect(insertReceipt).toHaveBeenCalledTimes(1)
  })

  it('settles an Organization-scoped mandatory delivery without inventing a Property', async () => {
    let queued: unknown
    const queue = withBetaOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt: vi.fn(async () => {}) },
    )
    const accountData = {
      ...DATA,
      propertyId: null,
      type: 'account.organization_access_removed',
      resourceType: 'organization',
      resourceId: DATA.organizationId,
      audience: {
        kind: 'affected_organization_user',
        eventId: DATA.eventId,
        eventType: 'identity.member.removed',
      },
    }

    await queue.add('insert-notification', accountData)

    expect(parseOutboxNotificationDelivery(queued)).toEqual(
      expect.objectContaining({
        eventType: 'identity.member.removed',
        consumerName: 'notification.on-identity-member-removed',
      }),
    )
  })

  it.each(
    BETA_NOTIFICATION_TRIGGER_MATRIX.flatMap((route) =>
      route.notifications.map((notification) => ({
        type: notification.type,
        eventType: route.eventType,
        consumerName: route.consumerName,
      })),
    ),
  )(
    'settles every active family: $type ← $eventType',
    async ({ type, eventType, consumerName }) => {
      let queued: unknown
      const queue = withBetaOutboxNotificationDelivery(
        {
          add: vi.fn(async (_name, data) => {
            queued = data
          }),
        },
        { insertReceipt: vi.fn(async () => {}) },
      )

      await queue.add('insert-notification', { ...DATA, type })

      expect(parseOutboxNotificationDelivery(queued)).toEqual(
        expect.objectContaining({ eventType, consumerName }),
      )
    },
  )

  it('keeps the beta-dark Badge path outside durable settlement', async () => {
    let queued: unknown
    const insertReceipt = vi.fn(async () => {})
    const queue = withBetaOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt },
    )

    await queue.add('insert-notification', {
      ...DATA,
      type: 'badge.awarded',
      resourceType: 'badge',
    })

    expect(queued).not.toHaveProperty('delivery')
    expect(insertReceipt).not.toHaveBeenCalled()
  })
})
