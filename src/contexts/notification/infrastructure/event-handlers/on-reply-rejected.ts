// Notification context — event handler for review.reply.rejected
// Notifies the reply author that their reply was rejected, including the reason if available.

import type { ReviewReplyRejected } from '#/contexts/review/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
}>

export const onReplyRejected =
  (deps: Deps) =>
  async (event: ReviewReplyRejected): Promise<void> => {
    const data: InsertNotificationJobData = {
      userId: event.userId,
      organizationId: event.organizationId,
      type: 'reply.rejected' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId,
      eventId: event.eventId,
      title: 'Reply rejected',
      body: event.reason ? `Rejected: ${event.reason}` : 'Your reply has been rejected',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
