// Durable delivery of a reply's outcomes — approved, rejected, published,
// failed to publish, cancelled after approval. Each reaches the reply's author,
// whoever put it up for approval; a failure the author cannot retry and a
// cancellation also reach whoever can act on the reply next.
//
// Split from workflow-outbox-consumers.ts, which parses the facts and routes
// them here: the reply routes are one family and change together.

import type { UserId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  ReplyPublishFailureOutcome,
  ReviewReplyApproved,
  ReviewReplyPublicationCancelled,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
} from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { ReplyApprovalAuthorityPort } from '../application/ports/reply-approval-authority.port'
import type { NotificationAudience } from '../application/notification-audience'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import { resolveReplyApprovalRecipients } from '../application/reply-approval-recipients'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { buildInboxItemPayload } from './notification-payload-facts'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'

export type ReplyOutcomeNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  replyApproval: ReplyApprovalAuthorityPort
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

/**
 * The durable cancellation fact. `authorId` is absent on facts recorded
 * before it existed, and null when the reply has no known author.
 */
export type DurableReplyPublicationCancelled = Omit<
  ReviewReplyPublicationCancelled,
  'authorId'
> &
  Readonly<{ authorId: UserId | null }>

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

/**
 * A publication that was cancelled after approval is silent everywhere else:
 * the reply is back in draft, and the author was last told it was queued to
 * publish to Google. So the author hears it, and so do the people who can
 * approve it again — the same people `reply.pending_approval` asks: the
 * Property's responsible managers who may approve, and the AccountAdmins only
 * when none of them can (I5.3). It used to go to every AccountAdmin in the
 * Organization, however many hotels they look after, while the responsible
 * approver who had just approved it was never told it went back to draft.
 *
 * The author is removed before that fallback is considered, as a submitter
 * is: they cannot approve their own reply, so when they are the only
 * responsible approver somebody else still has to. Their own notice is
 * audienced `property_operator`, which the delivery check re-tests against
 * the Property either way.
 *
 * A `policy` cancellation is what a Property Archive or a lost authority looks
 * like from here, so the approvers it took that authority from are left out:
 * telling them to re-approve something they can no longer touch is noise. The
 * other three causes take nobody's authority, so every approver is kept.
 */
async function publicationCancelledRecipients(
  deps: ReplyOutcomeNotificationDeps,
  event: DurableReplyPublicationCancelled,
): Promise<ReadonlyArray<Readonly<{ userId: UserId; audience: NotificationAudience }>>> {
  const { recipients: candidates, audience } = await resolveReplyApprovalRecipients(
    deps,
    {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      submitterId: event.authorId,
    },
  )
  const eligible = await Promise.all(
    candidates.map(async (approverId) =>
      event.cause !== 'policy' ||
      (await deps.responsibleManagers.isEligibleForProperty(
        event.organizationId,
        event.propertyId,
        approverId,
      ))
        ? approverId
        : null,
    ),
  )
  const approvers = eligible
    .filter((approverId): approverId is UserId => approverId !== null)
    .map((userId) => ({ userId, audience }))
  return event.authorId === null
    ? approvers
    : [{ userId: event.authorId, audience: { kind: 'property_operator' } }, ...approvers]
}

export async function enqueuePublicationCancelledNotifications(
  deps: ReplyOutcomeNotificationDeps,
  event: DurableReplyPublicationCancelled,
): Promise<void> {
  const recipients = await publicationCancelledRecipients(deps, event)
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification publication-cancelled delivery: no recipients found, skipping',
    )
    return
  }

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    publicationCancellationCause: event.cause,
  })
  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient.userId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: 'reply.publication_cancelled',
          resourceType: 'inbox_item',
          resourceId: inboxItem,
          eventId: event.eventId,
          payload,
          audience: recipient.audience,
        },
        { jobId: `${event.eventId}-${recipient.userId}` },
      ),
    ),
  )
}
