// Notification context — on-inbox-item-assigned event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import type { Queue } from 'bullmq'
import { organizationId, propertyId, inboxItemId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ITEM_ID = inboxItemId('item-1')
const ASSIGNED_TO = userId('user-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: InboxItemAssigned = {
  _tag: 'inbox.inbox_item.assigned',
  eventId: 'test-event-id',
  correlationId: null,
  inboxItemId: INBOX_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  userId: userId('assigner-1'),
  assignedTo: ASSIGNED_TO,
  source: 'web',
  occurredAt: NOW,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  return { queue, addMock, jobs }
}

describe('onInboxItemAssigned (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job with correct data', async () => {
    await onInboxItemAssigned(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ASSIGNED_TO,
        organizationId: ORG_ID,
        type: 'inbox.assigned',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'Item assigned to you',
        body: 'An inbox item has been assigned to you',
      },
    })
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemAssigned(deps)(mockEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
