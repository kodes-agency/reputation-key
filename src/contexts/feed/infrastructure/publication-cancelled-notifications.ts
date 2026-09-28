// The notice a cancelled publication raises: "Reply returned to draft".
//
// Kept apart from the other workflow routes because it is the one whose
// audience depends on the Property's lifecycle as well as on who may act on
// it.

import type { UserId } from '#/shared/domain/ids'
import type { ReviewReplyPublicationCancelled } from '#/contexts/review/application/public-api'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { ActivePropertyLookup } from '../application/ports/active-property.port'
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
    responsibleManagers: Pick<ResponsibleManagerLookupPort, 'isEligibleForProperty'>
    /** Whether the Property is still inside the workspace. */
    activeProperty: ActivePropertyLookup
  }>

/**
 * A publication that was cancelled after approval is silent everywhere else:
 * the reply is back in draft, and the author was last told it was queued to
 * publish to Google. So the author hears it, and so do the AccountAdmins, who
 * are the people who can approve it again (the same audience
 * `reply.pending_approval` asks).
 *
 * A `policy` cancellation is what a Property Archive or a lost authority looks
 * like from here, so the approvers it took that authority from are left out:
 * telling them to re-approve something they can no longer touch is noise. The
 * other three causes take nobody's authority, so every approver is kept.
 * The author's own notice is audienced `property_operator`, which the delivery
 * check re-tests against the Property either way.
 *
 * Property eligibility ignores the lifecycle, so it cannot tell an archive
 * apart: every AccountAdmin, the one who archived included, stayed an
 * "approver". A Property outside the workspace tells nobody — nothing can be
 * approved or published there, and the cancellation is the archive's own
 * consequence.
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
  const admins = await deps.userLookup.findByRole(event.organizationId, 'AccountAdmin')
  const approvers =
    event.cause === 'policy'
      ? (
          await Promise.all(
            admins.map(async (adminId) =>
              (await deps.responsibleManagers.isEligibleForProperty(
                event.organizationId,
                event.propertyId,
                adminId,
              ))
                ? adminId
                : null,
            ),
          )
        ).filter((adminId): adminId is UserId => adminId !== null)
      : admins
  const recipients = [
    ...new Set(event.authorId === null ? approvers : [event.authorId, ...approvers]),
  ]
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
    recipients.map((recipientId) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipientId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: 'reply.publication_cancelled',
          resourceType: 'inbox_item',
          resourceId: inboxItem,
          eventId: event.eventId,
          payload,
          audience:
            recipientId === event.authorId
              ? { kind: 'property_operator' }
              : { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}
