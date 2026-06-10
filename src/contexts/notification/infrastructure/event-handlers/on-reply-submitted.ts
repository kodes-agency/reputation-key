// Notification context — event handler for review.reply.submitted
// Maps to 'reply.pending_approval' notification for AccountAdmins.

import type { ReviewReplySubmitted } from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export const onReplySubmitted =
  (deps: Deps) =>
  async (event: ReviewReplySubmitted): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin',
    )

    if (recipients.length === 0) {
      deps.logger.warn(
        { organizationId: event.organizationId, eventId: event.eventId },
        'onReplySubmitted: no recipients found, skipping',
      )
      return
    }

    const jobs: InsertNotificationJobData[] = recipients.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      type: 'reply.pending_approval' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId,
      eventId: event.eventId,
      title: 'Reply pending approval',
      body: 'A reply is awaiting your approval',
    }))

    await Promise.all(
      jobs.map((data) => deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)),
    )
  }
