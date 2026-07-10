// Notification context — on-reply-submitted event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReplySubmitted } from './on-reply-submitted'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReplySubmittedEvent,
  buildExpectedJob,
  expectJobsEnqueued,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const submittedEvent = buildReplySubmittedEvent()

describe('onReplySubmitted (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job for each AccountAdmin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onReplySubmitted(deps)(submittedEvent)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin1,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'Reply pending approval',
        body: 'A reply is awaiting your approval',
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin2,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'Reply pending approval',
        body: 'A reply is awaiting your approval',
      }),
    )
  })

  it('looks up admins by orgId and AccountAdmin role', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onReplySubmitted(deps)(submittedEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      'AccountAdmin',
    )
  })

  it('does not enqueue any jobs when no AccountAdmins exist', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onReplySubmitted(deps)(submittedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no AccountAdmins exist', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onReplySubmitted(deps)(submittedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { organizationId: NOTIF_TEST_IDS.orgId, eventId: NOTIF_TEST_IDS.eventId },
      'onReplySubmitted: no recipients found, skipping',
    )
  })

  it('enqueues exactly one job for a single admin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await onReplySubmitted(deps)(submittedEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findByRole.mockRejectedValue(new Error('Auth service down'))

    await expect(onReplySubmitted(deps)(submittedEvent)).rejects.toThrow(
      'Auth service down',
    )
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplySubmitted(deps)(submittedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })

  it('skips when the review has no inbox item', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(null)

    await onReplySubmitted(deps)(submittedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })
})
