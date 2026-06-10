// Notification context — on-reply-approved event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onReplyApproved } from './on-reply-approved'
import type { ReviewReplyApproved } from '#/contexts/review/application/public-api'
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

const mockEvent: ReviewReplyApproved = {
  _tag: 'review.reply.approved',
  eventId: 'test-event-id',
  correlationId: null,
  replyId: REPLY_ID,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  userId: userId('approver-1'),
  authorId: AUTHOR_ID,
  source: 'web',
  occurredAt: NOW,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  return { queue, addMock, jobs }
}

describe('onReplyApproved (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job with correct data', async () => {
    await onReplyApproved(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: AUTHOR_ID,
        organizationId: ORG_ID,
        type: 'reply.approved',
        resourceType: 'reply',
        resourceId: REPLY_ID,
        eventId: 'test-event-id',
        title: 'Reply approved',
        body: 'Your reply has been approved',
      },
    })
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplyApproved(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
