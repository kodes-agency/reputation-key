// Notification context — on-reply-approved event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReplyApproved } from './on-reply-approved'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReplyApprovedEvent,
  buildExpectedJob,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const approvedEvent = buildReplyApprovedEvent()

describe('onReplyApproved (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job with correct data', async () => {
    await onReplyApproved(deps)(approvedEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.authorId,
        type: 'reply.approved',
        resourceType: 'reply',
        resourceId: NOTIF_TEST_IDS.replyId,
        title: 'Reply approved',
        body: 'Your reply has been approved',
      }),
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyApproved(deps)(approvedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
