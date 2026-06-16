// Notification context — on-inbox-item-escalated event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxItemEscalatedEvent,
  buildExpectedJob,
  expectJobsEnqueued,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const escalatedEvent = buildInboxItemEscalatedEvent()

describe('onInboxItemEscalated (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job for each admin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin1,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'Item escalated',
        body: `Inbox item ${NOTIF_TEST_IDS.inboxItemId} has been escalated and requires attention`,
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin2,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'Item escalated',
        body: `Inbox item ${NOTIF_TEST_IDS.inboxItemId} has been escalated and requires attention`,
      }),
    )
  })

  it('looks up admins by organizationId and AccountAdmin role', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      'AccountAdmin',
    )
  })

  it('does not enqueue any jobs when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { organizationId: NOTIF_TEST_IDS.orgId, eventId: NOTIF_TEST_IDS.eventId },
      'onInboxItemEscalated: no recipients found, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findByRole.mockRejectedValue(new Error('DB down'))

    await expect(onInboxItemEscalated(deps)(escalatedEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemEscalated(deps)(escalatedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
