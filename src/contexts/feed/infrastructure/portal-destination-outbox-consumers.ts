// Feed notification surface — "a site is waiting for approval".
//
// A custom site a Linktree link opens needs an account admin before guests can
// see the link (Portal CONTEXT.md). Until now nobody was told: the request sat
// under "Sites allowed for links" and the manager who asked could only wait.
// This route raises one notice per waiting site, for every account admin of the
// Organization (the owner's call: not the manager who asked), when the site is
// first asked for. It settles when the site is decided
// (`notification-settlement-outbox-consumers.ts`) or its Property is archived.
//
// The notice is filed under the site, not under a link or a Portal, because the
// site is what is decided: several links and Portals can open one. The Portal
// it names is only where the admin is sent to decide it.

import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  organizationId,
  portalApprovedDestinationId,
  propertyId,
  unbrand,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_PORTAL_DESTINATION_PENDING_CONSUMER =
  'notification.on-portal-destination-pending' as const

export type PortalDestinationNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    /** Portal-owned: the site's current state, host and the Portal to open. */
    destinations: Pick<PortalPublicApi, 'findDestinationApprovalNotificationFacts'>
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Payload = Readonly<{
  approvedDestinationId: string
  organizationId: string
  propertyId: string
  approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined'
}>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'portal.approved_destination.updated',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('portal approved-destination envelope attribution mismatch')
  }
  return payload
}

/**
 * Tell the account admins that a site is waiting. Only the first state of a
 * site is news here; a decision is the settlement route's. The site is read
 * again first: a decision made while the event waited leaves nothing to ask.
 */
export async function handleNotificationPortalDestinationPending(
  deps: PortalDestinationNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parse(event)
  const organization = organizationId(payload.organizationId)
  const property = propertyId(payload.propertyId)
  const site =
    payload.approvalState === 'pending'
      ? await deps.destinations.findDestinationApprovalNotificationFacts(
          organization,
          portalApprovedDestinationId(payload.approvedDestinationId),
        )
      : null
  if (site === null || site.approvalState !== 'pending' || site.portal === null) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_PORTAL_DESTINATION_PENDING_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const admins = await deps.userLookup.findByRole(organization, 'AccountAdmin')
  if (admins.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'Waiting-site notification has no AccountAdmin recipients',
    )
  }
  // An admin who asked for the site from the list asked on purpose and is
  // looking at it; the others are who the notice is for.
  const recipients = admins.filter((admin) => admin !== site.requestedBy)
  const where = await buildPropertyPayload(deps, organization, property)
  const notice = {
    ...where,
    siteHost: site.hostname,
    portalName: site.portal.name,
    portalId: site.portal.id,
    ...(site.otherPortalCount > 0 ? { otherPortalCount: site.otherPortalCount } : {}),
  }

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: 'portal.link_approval' as const,
          resourceType: 'portal_destination' as const,
          resourceId: payload.approvedDestinationId,
          eventId: event.eventId,
          payload: notice,
          // Decided by the role alone, rechecked at delivery: whoever is no
          // longer an account admin by then hears nothing.
          audience: { kind: 'account_admin' as const },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PORTAL_DESTINATION_PENDING_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerPortalDestinationNotificationConsumer(
  registry: ConsumerRegistry,
  deps: PortalDestinationNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'portal.approved_destination.updated',
    consumerName: 'notification.on-portal-destination-pending',
    module: 'notification.portal-destination-outbox-consumers',
    handler: (event) => handleNotificationPortalDestinationPending(deps, event),
  })
}
