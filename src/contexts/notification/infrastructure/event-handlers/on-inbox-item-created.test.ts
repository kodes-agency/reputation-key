// Notification context — on-inbox-item-created event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxItemCreated } from './on-inbox-item-created'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxItemCreatedEvent,
  buildExpectedJob,
  EXPECTED_INBOX_PAYLOAD,
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
    // Facts come from the item, not the event: portal-sourced feedback.
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: 'prop-1',
      propertyName: 'Riverside Hotel',
      rating: 4,
      sourceType: 'feedback',
      createdAt: new Date('2026-06-01T11:30:00.000Z'),
    })

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expectJobsEnqueued(deps, 2)
    const expectedPayload = {
      propertyName: 'Riverside Hotel',
      rating: 4,
      platform: 'portal',
      // 30 minutes old — under an hour, so the copy shows no age at all.
      waitingHours: 0,
    } as const
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: expectedPayload,
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager2,
        type: 'feedback.created',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: expectedPayload,
      }),
    )
  })

  it('never carries guest or review content into the payload', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    // ADR 0046 r.8 / BQC-1.2: the inbox row also holds a snippet, a reviewer
    // name and media. None of it may reach a notification.
    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ payload: EXPECTED_INBOX_PAYLOAD }),
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
        // The rating IS carried — a 1-5 star number is a numeric fact, not
        // source content (ADR 0046 r.8). The review TEXT never is.
        payload: EXPECTED_INBOX_PAYLOAD,
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

  it('falls back to the org AccountAdmins when no manager is assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      'AccountAdmin',
    )
    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.queue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: NOTIF_TEST_IDS.admin1 }),
    )
    expect(deps.queue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: NOTIF_TEST_IDS.admin2 }),
    )
    expect(deps.logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      'onInboxItemCreated: no recipients found',
    )
  })

  it('does not look up AccountAdmins when a manager is assigned', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
    expect(deps.queue.add).toHaveBeenCalledTimes(1)
  })

  it('does not enqueue any jobs when there is no manager and no AccountAdmin', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('warns only when neither a manager nor an AccountAdmin exists', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemCreated(deps)(itemCreatedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { correlationId: undefined },
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
