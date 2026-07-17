// Notification context — on-inbox-item-created event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxItemCreated } from './on-inbox-item-created'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxItemCreatedEvent,
  buildExpectedJob,
  expectJobsEnqueued,
  stubManagerForQueueAddError,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const itemCreatedEvent = buildInboxItemCreatedEvent()

describe('onInboxItemCreated (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job for each assigned manager for feedback source', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'New feedback',
        body: 'A guest submitted feedback',
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager2,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'New feedback',
        body: 'A guest submitted feedback',
      }),
    )
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      NOTIF_TEST_IDS.propId,
    )
  })

  it('enqueues review.created notifications for review source', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.manager1])
    const reviewSourceEvent = buildInboxItemCreatedEvent({
      sourceType: 'review',
    })

    await onInboxItemCreated(deps)(reviewSourceEvent)

    expectJobsEnqueued(deps, 1)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'review.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'New review',
        // BQC-1.2: content-free body — no star count (raw rating never copied).
        body: 'New review received',
      }),
    )
  })

  it('logs debug for unknown source types', async () => {
    const unknownSourceEvent = {
      ...itemCreatedEvent,
      sourceType: 'goal' as typeof itemCreatedEvent.sourceType,
    }

    await onInboxItemCreated(deps)(unknownSourceEvent)

    expect(deps.logger.debug).toHaveBeenCalledWith(
      'onInboxItemCreated: skipping unknown source',
      { sourceType: 'goal' },
    )
  })

  it('does not enqueue any jobs when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no managers are assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: NOTIF_TEST_IDS.propId, eventId: NOTIF_TEST_IDS.eventId },
      'onInboxItemCreated: no recipients found',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onInboxItemCreated(deps)(itemCreatedEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    stubManagerForQueueAddError(deps)

    await expect(onInboxItemCreated(deps)(itemCreatedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
