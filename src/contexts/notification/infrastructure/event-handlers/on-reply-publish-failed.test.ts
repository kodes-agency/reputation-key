// Notification context — on-reply-publish-failed event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReplyPublishFailed } from './on-reply-publish-failed'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReplyPublishFailedEvent,
  buildExpectedJob,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const publishFailedEvent = buildReplyPublishFailedEvent()

describe('onReplyPublishFailed (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job with correct data', async () => {
    await onReplyPublishFailed(deps)(publishFailedEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.authorId,
        type: 'reply.publish_failed',
        resourceType: 'reply',
        resourceId: NOTIF_TEST_IDS.replyId,
        title: 'Reply publish failed',
        body: 'Failed to publish your reply to Google. Please retry.',
      }),
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyPublishFailed(deps)(publishFailedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
