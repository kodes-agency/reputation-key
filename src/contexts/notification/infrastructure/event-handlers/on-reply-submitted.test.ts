// Notification context — on-reply-submitted event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onReplySubmitted } from './on-reply-submitted'
import type { ReviewReplySubmitted } from '#/contexts/review/application/public-api'
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
const ADMIN_1 = userId('admin-1')
const ADMIN_2 = userId('admin-2')
const USER_ID = userId('user-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: ReviewReplySubmitted = {
  _tag: 'review.reply.submitted',
  eventId: 'test-event-id',
  correlationId: null,
  replyId: REPLY_ID,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  userId: USER_ID,
  source: 'web',
  occurredAt: NOW,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  const userLookup = {
    findAssignedManagers: vi.fn(),
    findByRole: vi.fn(),
    getEmail: vi.fn(),
    getName: vi.fn(),
  }
  return { queue, addMock, userLookup, jobs }
}

describe('onReplySubmitted (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job for each AccountAdmin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([ADMIN_1, ADMIN_2])

    await onReplySubmitted(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ADMIN_1,
        organizationId: ORG_ID,
        type: 'reply.pending_approval',
        resourceType: 'reply',
        resourceId: REPLY_ID,
        eventId: 'test-event-id',
        title: 'Reply pending approval',
        body: 'A reply is awaiting your approval',
      },
    })
    expect(deps.jobs[1]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ADMIN_2,
        organizationId: ORG_ID,
        type: 'reply.pending_approval',
        resourceType: 'reply',
        resourceId: REPLY_ID,
        eventId: 'test-event-id',
        title: 'Reply pending approval',
        body: 'A reply is awaiting your approval',
      },
    })
  })

  it('looks up admins by orgId and AccountAdmin role', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onReplySubmitted(deps)(mockEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG_ID, 'AccountAdmin')
  })

  it('does not enqueue any jobs when no AccountAdmins exist', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onReplySubmitted(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('enqueues exactly one job for a single admin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([ADMIN_1])

    await onReplySubmitted(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findByRole.mockRejectedValue(new Error('Auth service down'))

    await expect(onReplySubmitted(deps)(mockEvent)).rejects.toThrow('Auth service down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findByRole.mockResolvedValue([ADMIN_1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onReplySubmitted(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
