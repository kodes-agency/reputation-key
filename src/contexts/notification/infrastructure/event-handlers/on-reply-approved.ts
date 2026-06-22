// Notification context — event handler for review.reply.approved
// Notifies the reply author that their reply was approved.

import type { ReviewReplyApproved } from '#/contexts/review/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
}>

export const onReplyApproved =
  (deps: Deps) =>
  async (event: ReviewReplyApproved): Promise<void> => {
    // Mirror replies (google_sync) have no human author — no one to notify.
    if (!event.authorId) return

    const data: InsertNotificationJobData = {
      userId: event.authorId,
      organizationId: event.organizationId,
      type: 'reply.approved' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId,
      eventId: event.eventId,
      title: 'Reply approved',
      body: 'Your reply has been approved',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
