// Notification context — reply-notification handler factory (BQC-5.9 E9).
//
// Single source for reply lifecycle → author notification routing: mirror
// replies (google_sync — no human author) are skipped; the review resolves
// to its inbox item (ADR 0022) and the notification is skipped when the
// item is gone; then the insert-notification job is enqueued. The 4 reply
// handlers are one-liners over this factory.
//
// Each handler supplies a TYPE and, where the event carries one, the extra
// facts that type's template can use (reply.rejected's moderation reason).
// None of them supplies copy — that is rendered from (type, payload) in
// domain/notification-templates.ts.

import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildInboxItemPayload } from './payload-facts'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

/** Common shape of reply lifecycle events that notify the reply author. */
export type ReplyNotificationEvent = Readonly<{
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  authorId: UserId | null
}>

export type ReplyNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  inboxItemLookup: InboxItemLookupPort
  userLookup: UserLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export function makeReplyNotificationHandler<E extends ReplyNotificationEvent>(opts: {
  type: InsertNotificationJobData['type']
  /**
   * Per-type extra facts drawn from the event. Only ADR 0046 r.8 allowlisted
   * values belong here — `reply.rejected` passes its staff-authored reason, the
   * other three pass nothing.
   */
  facts?: (event: E) => Readonly<{ moderationReason?: string | null }>
  /**
   * Whose action produced the notification, when the template names a role.
   * `reply.pending_approval` says "A property manager drafted a reply"; the
   * approved/rejected/published/failed templates address the author directly
   * and name no one.
   */
  actor?: (event: E) => UserId | null
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

      const payload = await buildInboxItemPayload(deps, {
        inboxItemId,
        orgId: event.organizationId,
        actorId: opts.actor?.(event) ?? null,
        moderationReason: opts.facts?.(event).moderationReason ?? null,
      })

      const data: InsertNotificationJobData = {
        userId: event.authorId,
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        type: opts.type,
        resourceType: 'inbox_item' as const,
        resourceId: inboxItemId,
        eventId: event.eventId,
        payload,
        audience: { kind: 'property_operator' },
      }

      await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
        jobId: `${event.eventId}-${event.authorId}`,
      })
    }
}
