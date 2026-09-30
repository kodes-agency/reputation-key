// Feed notification surface — the inviter hears that an invitation was accepted.
//
// Rides the same `identity.invitation.accepted` fact as the new member's own
// "You joined" notice, in a second durable consumer so each notice is received,
// retried and receipted on its own. The recipient is the inviter the fact names;
// the notice never says who accepted (ADR 0046 r.8).
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, userId } from '#/shared/domain/ids'
import type { ConsumerEvent, OutboxRepository } from '#/shared/outbox'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildOrganizationPayload,
  type OrganizationPayloadDeps,
} from './notification-payload-facts'

export const INVITATION_ACCEPTED_INVITER_CONSUMER =
  'notification.on-identity-invitation-accepted-inviter' as const

export type InvitationAcceptedInviterNoticeDeps = OrganizationPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type InvitationAcceptedPayload = Readonly<{
  organizationId: string
  inviterId?: string
}>

/**
 * Queue the inviter's notice.
 *
 * `obsolete` is a real, recorded outcome: a fact recorded before it named its
 * inviter cannot produce one, and treating that as a failure would retry
 * forever. An inviter who is not an AccountAdmin of the Organization when the
 * job is delivered (they left, were demoted, are a platform operator who never
 * was one, or are a PropertyManager who invited before PropertyManagers lost
 * invitations) is refused then, by the `account_admin` audience.
 */
export async function handleInvitationAcceptedInviterNotice(
  deps: InvitationAcceptedInviterNoticeDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  if (event.propertyId !== null || event.sourceContext !== 'identity') {
    throw new Error('Invitation accepted envelope attribution mismatch')
  }
  const payload = validateEventPayload(
    'identity.invitation.accepted',
    event.eventVersion,
    event.payload,
  ) as InvitationAcceptedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Invitation accepted envelope attribution mismatch')
  }
  const { inviterId } = payload
  if (inviterId === undefined || inviterId === '') {
    await deps.receipts.insertReceipt(
      event.eventId,
      INVITATION_ACCEPTED_INVITER_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const organization = organizationId(event.organizationId)
  const named = await buildOrganizationPayload(deps, organization)
  await deps.queue.add(
    INSERT_NOTIFICATION_JOB_NAME,
    {
      userId: userId(inviterId),
      organizationId: organization,
      propertyId: null,
      type: 'account.invitation_accepted',
      resourceType: 'organization',
      resourceId: event.organizationId,
      eventId: event.eventId,
      ...(Object.keys(named).length > 0 ? { payload: named } : {}),
      audience: { kind: 'account_admin' },
    },
    // Apart from the new member's own job for the same fact.
    { jobId: `${event.eventId}-inviter-${inviterId}` },
  )
  await deps.receipts.insertReceipt(
    event.eventId,
    INVITATION_ACCEPTED_INVITER_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}
