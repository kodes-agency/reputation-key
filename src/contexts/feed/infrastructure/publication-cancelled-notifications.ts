// The notice a cancelled publication raises: "Reply returned to draft".
//
// Kept apart from the other workflow routes because it is the one whose
// audience depends on the Property's lifecycle as well as on who may act on
// it.

import type { UserId } from '#/shared/domain/ids'
import type { ReviewReplyPublicationCancelled } from '#/contexts/review/application/public-api'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { ReplyApprovalAuthorityPort } from '../application/ports/reply-approval-authority.port'
import type { ActivePropertyLookup } from '../application/ports/active-property.port'
import type { NotificationAudience } from '../application/notification-audience'
import { resolveReplyApprovalRecipients } from '../application/reply-approval-recipients'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildInboxItemPayload,
  type InboxPayloadDeps,
} from './notification-payload-facts'

/**
 * The durable cancellation fact. `authorId` is absent on facts recorded
 * before it existed, and null when the reply has no known author.
 */
export type DurableReplyPublicationCancelled = Omit<
  ReviewReplyPublicationCancelled,
  'authorId'
> &
  Readonly<{ authorId: UserId | null }>

export type PublicationCancelledNotificationDeps = InboxPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    responsibleManagers: Pick<
      ResponsibleManagerLookupPort,
      'findForProperty' | 'isEligibleForProperty'
    >
    /** Who may act on an approval request, asked at fan-out and again at send. */
    replyApproval: ReplyApprovalAuthorityPort
    /** Whether the Property is still inside the workspace. */
    activeProperty: ActivePropertyLookup
  }>

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
  deps: PublicationCancelledNotificationDeps,
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

/**
 * Property eligibility ignores the lifecycle, so it cannot tell an archive
 * apart: every approver, the AccountAdmin who archived included, stayed an
 * "approver". A Property outside the workspace tells nobody, the author
 * included — nothing can be approved or published there, and the
 * cancellation is the archive's own consequence.
 */
export async function enqueuePublicationCancelledNotifications(
  deps: PublicationCancelledNotificationDeps,
  event: DurableReplyPublicationCancelled,
): Promise<void> {
  if (!(await deps.activeProperty(event.organizationId, event.propertyId))) {
    deps.logger.info(
      { correlationId: event.correlationId ?? undefined },
      'notification publication-cancelled delivery: Property is not active, skipping',
    )
    return
  }
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
