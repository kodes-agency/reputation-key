// Notification context — on-reply-rejected event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onReplyRejected } from './on-reply-rejected'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildReplyRejectedEvent,
  buildExpectedJob,
  EXPECTED_INBOX_PAYLOAD,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const rejectedEvent = buildReplyRejectedEvent()
const rejectedNoReasonEvent = buildReplyRejectedEvent({ reason: null })

describe('onReplyRejected (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job carrying the moderation reason as a fact', async () => {
    await onReplyRejected(deps)(rejectedEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.authorId,
        type: 'reply.rejected',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: {
          ...EXPECTED_INBOX_PAYLOAD,
          moderationReason: 'Tone too aggressive',
        },
      }),
    )
  })

  it('omits the reason key entirely when the moderator gave none', async () => {
    await onReplyRejected(deps)(rejectedNoReasonEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ payload: EXPECTED_INBOX_PAYLOAD }),
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyRejected(deps)(rejectedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })

  it('skips when the review has no inbox item', async () => {
    deps.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(null)

    await onReplyRejected(deps)(rejectedEvent)

    expect(deps.jobs).toHaveLength(0)
  })
})
