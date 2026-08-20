// Notification context — reply-notification handler factory (BQC-5.9 E9).
//
// Single source for reply lifecycle → author notification routing: mirror
// replies (google_sync — no human author) are skipped; the review resolves
// to its inbox item (ADR 0022) and the notification is skipped when the
// item is gone; then the insert-notification job is enqueued. The 4 reply
// handlers are one-liners over this factory.

import type { Queue } from 'bullmq'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'

/** Common shape of reply lifecycle events that notify the reply author. */
export type ReplyNotificationEvent = Readonly<{
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  authorId: UserId | null
}>

export type ReplyNotificationDeps = Readonly<{
  queue: Queue
  inboxItemLookup: InboxItemLookupPort
}>

export function makeReplyNotificationHandler<E extends ReplyNotificationEvent>(opts: {
  type: InsertNotificationJobData['type']
  title: string
  body: string | ((event: E) => string)
}) {
  return (deps: ReplyNotificationDeps) =>
    async (event: E): Promise<void> => {
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
        propertyId: event.propertyId,
        type: opts.type,
        resourceType: 'inbox_item' as const,
        resourceId: inboxItemId,
        eventId: event.eventId,
        title: opts.title,
        body: typeof opts.body === 'function' ? opts.body(event) : opts.body,
      }

      await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
    }
}
