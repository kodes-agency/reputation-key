// Notification context — event handler for review.reply.publish_failed
// Notifies the reply author that publishing to Google failed.

import type { ReviewReplyPublishFailed } from '#/contexts/review/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
}>

export const onReplyPublishFailed =
  (deps: Deps) =>
  async (event: ReviewReplyPublishFailed): Promise<void> => {
    const data: InsertNotificationJobData = {
      userId: event.authorId,
      organizationId: event.organizationId,
      type: 'reply.publish_failed' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId,
      eventId: event.eventId,
      title: 'Reply publish failed',
      body: 'Failed to publish your reply to Google. Please retry.',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
