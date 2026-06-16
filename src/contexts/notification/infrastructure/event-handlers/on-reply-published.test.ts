// Notification context — on-reply-published event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReplyPublished } from './on-reply-published'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReplyPublishedEvent,
  buildExpectedJob,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const publishedEvent = buildReplyPublishedEvent()

describe('onReplyPublished (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job with correct data', async () => {
    await onReplyPublished(deps)(publishedEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.authorId,
        type: 'reply.published',
        resourceType: 'reply',
        resourceId: NOTIF_TEST_IDS.replyId,
        title: 'Reply published',
        body: 'Your reply has been published to Google',
      }),
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyPublished(deps)(publishedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
