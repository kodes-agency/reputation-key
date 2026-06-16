// Notification context — on-review-created event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReviewCreated } from './on-review-created'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReviewCreatedEvent,
  buildExpectedJob,
  expectJobsEnqueued,
  stubManagerForQueueAddError,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const reviewEvent = buildReviewCreatedEvent()

describe('onReviewCreated (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job for each assigned manager', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await onReviewCreated(deps)(reviewEvent)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.reviewId,
        title: 'New review',
        body: '4-star review received',
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager2,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.reviewId,
        title: 'New review',
        body: '4-star review received',
      }),
    )
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(reviewEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      NOTIF_TEST_IDS.propId,
    )
  })

  it('does not enqueue any jobs when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(reviewEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onReviewCreated(deps)(reviewEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: NOTIF_TEST_IDS.propId, eventId: NOTIF_TEST_IDS.eventId },
      'onReviewCreated: no recipients found, skipping',
    )
  })

  it('includes the correct rating in the body text', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    const event5Stars = buildReviewCreatedEvent({ rating: 5 })
    await onReviewCreated(deps)(event5Stars)

    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ body: '5-star review received' }),
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onReviewCreated(deps)(reviewEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    stubManagerForQueueAddError(deps)

    await expect(onReviewCreated(deps)(reviewEvent)).rejects.toThrow('Queue unavailable')
  })
})
