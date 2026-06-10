// Notification context — on-reply-rejected event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onReplyRejected } from './on-reply-rejected'
import type { ReviewReplyRejected } from '#/contexts/review/application/public-api'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const AUTHOR_ID = userId('author-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEventWithReason: ReviewReplyRejected = {
  _tag: 'review.reply.rejected',
  eventId: 'test-event-id',
  correlationId: null,
  replyId: REPLY_ID,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  userId: userId('rejector-1'),
  authorId: AUTHOR_ID,
  reason: 'Tone too aggressive',
  source: 'web',
  occurredAt: NOW,
}

const mockEventNoReason: ReviewReplyRejected = {
  ...mockEventWithReason,
  reason: null,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  return { queue, addMock, jobs }
}

describe('onReplyRejected (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job with reason in body', async () => {
    await onReplyRejected(deps)(mockEventWithReason)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: AUTHOR_ID,
        organizationId: ORG_ID,
        type: 'reply.rejected',
        resourceType: 'reply',
        resourceId: REPLY_ID,
        eventId: 'test-event-id',
        title: 'Reply rejected',
        body: 'Rejected: Tone too aggressive',
      },
    })
  })

  it('enqueues a notification job with default body when no reason', async () => {
    await onReplyRejected(deps)(mockEventNoReason)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ body: 'Your reply has been rejected' }),
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyRejected(deps)(mockEventWithReason)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
