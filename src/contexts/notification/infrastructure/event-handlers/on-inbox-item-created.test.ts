// Notification context — on-inbox-item-created event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onInboxItemCreated } from './on-inbox-item-created'
import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  inboxItemId,
  userId,
  reviewId,
} from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ITEM_ID = inboxItemId('item-1')
const REVIEW_ID = reviewId('rev-1')
const MANAGER_1 = userId('mgr-1')
const MANAGER_2 = userId('mgr-2')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: InboxItemCreated = {
  _tag: 'inbox.inbox_item.created',
  eventId: 'test-event-id',
  correlationId: null,
  inboxItemId: INBOX_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType: 'feedback',
  sourceId: REVIEW_ID,
  userId: null,
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

describe('onInboxItemCreated (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job for each assigned manager for feedback source', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1, MANAGER_2])

    await onInboxItemCreated(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_1,
        organizationId: ORG_ID,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'New feedback',
        body: 'A guest submitted feedback',
      },
    })
    expect(deps.jobs[1]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_2,
        organizationId: ORG_ID,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'New feedback',
        body: 'A guest submitted feedback',
      },
    })
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(mockEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('skips non-feedback sources', async () => {
    const reviewEvent: InboxItemCreated = { ...mockEvent, sourceType: 'review' as const }

    await onInboxItemCreated(deps)(reviewEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.userLookup.findAssignedManagers).not.toHaveBeenCalled()
  })

  it('logs debug for non-feedback sources', async () => {
    const reviewEvent: InboxItemCreated = { ...mockEvent, sourceType: 'review' as const }

    await onInboxItemCreated(deps)(reviewEvent)

    expect(deps.logger.debug).toHaveBeenCalledWith(
      'onInboxItemCreated: skipping non-feedback source',
      { sourceType: 'review' },
    )
  })

  it('does not enqueue any jobs when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(mockEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: PROP_ID, eventId: 'test-event-id' },
      'onInboxItemCreated: no recipients found for feedback notification',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onInboxItemCreated(deps)(mockEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemCreated(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
