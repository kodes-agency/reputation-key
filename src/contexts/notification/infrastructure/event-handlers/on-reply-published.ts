// Notification context — event handler for review.reply.published
// Notifies the reply author that their reply was published to Google.

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'

type Deps = Readonly<{
  queue: Queue
  inboxItemLookup: InboxItemLookupPort
}>

export const onReplyPublished =
  (deps: Deps) =>
  async (event: ReviewReplyPublished): Promise<void> => {
    // Mirror replies (google_sync) have no human author — no one to notify.
    if (!event.authorId) return

    // Resolve the review to its inbox item (ADR 0022); skip if it's gone.
    const inboxItemId = await deps.inboxItemLookup.findInboxItemByReviewId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    const data: InsertNotificationJobData = {
      userId: event.authorId,
      organizationId: event.organizationId,
      type: 'reply.published' as const,
      resourceType: 'inbox_item' as const,
      resourceId: inboxItemId,
      eventId: event.eventId,
      title: 'Reply published',
      body: 'Your reply has been published to Google',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
