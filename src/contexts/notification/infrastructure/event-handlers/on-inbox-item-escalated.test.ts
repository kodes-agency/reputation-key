// Notification context — on-inbox-item-escalated event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import type { InboxItemEscalated } from '#/contexts/inbox/application/public-api'
import type { Queue } from 'bullmq'
import { organizationId, propertyId, inboxItemId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ITEM_ID = inboxItemId('item-1')
const ADMIN_1 = userId('admin-1')
const ADMIN_2 = userId('admin-2')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: InboxItemEscalated = {
  _tag: 'inbox.inbox_item.escalated',
  eventId: 'test-event-id',
  correlationId: null,
  inboxItemId: INBOX_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  userId: userId('user-1'),
  oldStatus: 'new',
  source: 'web',
  occurredAt: NOW,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  const userLookup = {
    findAssignedManagers: vi.fn(),
    findByRole: vi.fn(),
    getEmail: vi.fn(),
    getName: vi.fn(),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return { queue, addMock, userLookup, logger, jobs }
}

describe('onInboxItemEscalated (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job for each admin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([ADMIN_1, ADMIN_2])

    await onInboxItemEscalated(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ADMIN_1,
        organizationId: ORG_ID,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'Item escalated',
        body: 'An inbox item has been escalated',
      },
    })
    expect(deps.jobs[1]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ADMIN_2,
        organizationId: ORG_ID,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'Item escalated',
        body: 'An inbox item has been escalated',
      },
    })
  })

  it('looks up admins by organizationId and AccountAdmin role', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(mockEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG_ID, 'AccountAdmin')
  })

  it('does not enqueue any jobs when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(mockEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { organizationId: ORG_ID, eventId: 'test-event-id' },
      'onInboxItemEscalated: no recipients found, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findByRole.mockRejectedValue(new Error('DB down'))

    await expect(onInboxItemEscalated(deps)(mockEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findByRole.mockResolvedValue([ADMIN_1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemEscalated(deps)(mockEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
