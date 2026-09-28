// Durable delivery of a reply's outcomes — approved, rejected, published,
// failed to publish. Each reaches the reply's author, whoever put it up for
// approval; a failure the author cannot retry reaches whoever can act on the
// reply next. A cancellation after approval has its own module
// (publication-cancelled-notifications.ts): its audience also depends on the
// Property's lifecycle.
//
// Split from workflow-outbox-consumers.ts, which parses the facts and routes
// them here: the reply routes are one family and change together.

import type { UserId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  ReplyPublishFailureOutcome,
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
} from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { buildInboxItemPayload } from './notification-payload-facts'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'

export type ReplyOutcomeNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  logger: LoggerPort
}>

/**
 * The durable rejection fact. The reason stays on the reply (ADR 0030); the
 * fact says only whether there is one, and a fact recorded before it said so
 * says neither (`null`).
 */
export type DurableReplyRejected = Omit<ReviewReplyRejected, 'reason' | 'hasReason'> &
  Readonly<{ hasReason: boolean | null }>

/**
 * The durable publish-failure fact. One recorded before it said how the
 * publication ended says nothing (`null`), and the notice claims no cause.
 */
export type DurableReplyPublishFailed = Omit<ReviewReplyPublishFailed, 'outcome'> &
  Readonly<{ outcome: ReplyPublishFailureOutcome | null }>

type ReplyAuthorEvent =
  | ReviewReplyApproved
  | DurableReplyRejected
  | ReviewReplyPublished
  | DurableReplyPublishFailed

/** Who approved or rejected. Publication outcomes come from Google, not a person. */
const replyDecider = (event: ReplyAuthorEvent): UserId | null =>
  event._tag === 'review.reply.approved' || event._tag === 'review.reply.rejected'
    ? event.userId
    : null

export async function enqueueReplyAuthorNotification(
  deps: ReplyOutcomeNotificationDeps,
  event: ReplyAuthorEvent,
  type: InsertNotificationJobData['type'],
): Promise<void> {
  if (!event.authorId) return
  // Deciding on your own reply is not news to you; Google's verdict still is.
  if (replyDecider(event) === event.authorId) return

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    hasModerationReason: event._tag === 'review.reply.rejected' ? event.hasReason : null,
    publishOutcome: event._tag === 'review.reply.publish_failed' ? event.outcome : null,
    publishFailureCause:
      event._tag === 'review.reply.publish_failed' ? (event.cause ?? null) : null,
  })
  await deps.queue.add(
    INSERT_NOTIFICATION_JOB_NAME,
    {
      userId: event.authorId,
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      type,
      resourceType: 'inbox_item',
      resourceId: inboxItem,
      eventId: event.eventId,
      payload,
      audience: { kind: 'property_operator' },
    },
    { jobId: `${event.eventId}-${event.authorId}` },
  )
}

/**
 * A reply that failed to publish still needs someone to retry it. The author
 * gets the notice while they can still act on the Property. Otherwise — they
 * left, lost access, or are unknown — the Property's responsible managers own
 * this Google work and get it (AccountAdmins when none is eligible). Delivery
 * rechecks whichever audience was chosen.
 */
export async function enqueuePublishFailedNotification(
  deps: ReplyOutcomeNotificationDeps,
  event: DurableReplyPublishFailed,
): Promise<void> {
  const authorCanRetry =
    event.authorId !== null &&
    (await deps.responsibleManagers.isEligibleForProperty(
      event.organizationId,
      event.propertyId,
      event.authorId,
    ))
  if (authorCanRetry) {
    await enqueueReplyAuthorNotification(deps, event, 'reply.publish_failed')
    return
  }

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return
  const scope = { kind: 'property', propertyId: event.propertyId } as const
  const recipients = await resolveResponsibleRecipients(deps, event.organizationId, scope)
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    publishOutcome: event.outcome,
    // A manager cannot retry past a lapsed Google grant any more than the
    // author could, so they need the reconnect cause too.
    publishFailureCause: event.cause ?? null,
  })
  await Promise.all(
    recipients.map((recipientId) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipientId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: 'reply.publish_failed',
          resourceType: 'inbox_item',
          resourceId: inboxItem,
          eventId: event.eventId,
          payload,
          audience: { kind: 'responsible_scope', scope },
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}
