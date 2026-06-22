// Notification context — event handler for review.reply.published
// Notifies the reply author that their reply was published to Google.

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
}>

export const onReplyPublished =
  (deps: Deps) =>
  async (event: ReviewReplyPublished): Promise<void> => {
    // Mirror replies (google_sync) have no human author — no one to notify.
    if (!event.authorId) return

    const data: InsertNotificationJobData = {
      userId: event.authorId,
      organizationId: event.organizationId,
      type: 'reply.published' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId,
      eventId: event.eventId,
      title: 'Reply published',
      body: 'Your reply has been published to Google',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
