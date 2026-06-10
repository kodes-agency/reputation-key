// Notification context — on-review-created event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onReviewCreated } from './on-review-created'
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { Queue } from 'bullmq'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const REVIEW_ID = reviewId('rev-1')
const MANAGER_1 = userId('mgr-1')
const MANAGER_2 = userId('mgr-2')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: ReviewCreated = {
  _tag: 'review.created',
  eventId: 'test-event-id',
  correlationId: null,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  platform: 'google',
  externalId: 'ext-1',
  rating: 4,
  reviewText: 'Nice hotel',
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

describe('onReviewCreated (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job for each assigned manager', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1, MANAGER_2])

    await onReviewCreated(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_1,
        organizationId: ORG_ID,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: REVIEW_ID,
        eventId: 'test-event-id',
        title: 'New review',
        body: '4-star review received',
      },
    })
    expect(deps.jobs[1]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_2,
        organizationId: ORG_ID,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: REVIEW_ID,
        eventId: 'test-event-id',
        title: 'New review',
        body: '4-star review received',
      },
    })
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(mockEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(PROP_ID)
  })

  it('does not enqueue any jobs when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(mockEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: PROP_ID, eventId: 'test-event-id' },
      'onReviewCreated: no recipients found, skipping',
    )
  })

  it('includes the correct rating in the body text', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1])

    const event5Stars: ReviewCreated = { ...mockEvent, rating: 5 }
    await onReviewCreated(deps)(event5Stars)

    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ body: '5-star review received' }),
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onReviewCreated(deps)(mockEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReviewCreated(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
