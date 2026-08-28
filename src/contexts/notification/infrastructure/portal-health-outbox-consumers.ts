import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId, unbrand } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import {
  isActionablePortalHealthReason,
  type PortalHealthReason,
  type PortalHealthStatus,
} from '../application/portal-health-notification'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_PORTAL_HEALTH_CHANGED_CONSUMER =
  'notification.on-portal-health-changed' as const

type Payload = Readonly<{
  portalId: string
  organizationId: string
  propertyId: string
  previousStatus: PortalHealthStatus
  previousReason: PortalHealthReason
  status: PortalHealthStatus
  reason: PortalHealthReason
  sourceVersion: string
  occurredAt: string
}>

export type PortalHealthNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  responsibleManagers: ResponsibleManagerLookupPort
  userLookup: Pick<UserLookupPort, 'findByRole'>
  receipts: Pick<OutboxRepository, 'insertReceipt'>
  logger: LoggerPort
}>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'portal.health.changed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId ||
    payload.portalId !== event.sourceAggregateId
  ) {
    throw new Error('Portal Health envelope attribution mismatch')
  }
  return payload
}

/**
 * Serious automatic Health degradation is Action Required. Intentional
 * publication states, responsibility-needed (which has its own trigger),
 * awaiting-refresh, and recovery are receipt-only so managers are not nudged
 * for expected or already-resolved states.
 */
export async function handleNotificationPortalHealthChanged(
  deps: PortalHealthNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parse(event)
  if (payload.status === 'healthy' || !isActionablePortalHealthReason(payload.reason)) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_PORTAL_HEALTH_CHANGED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const organization = organizationId(payload.organizationId)
  const property = propertyId(payload.propertyId)
  const portal = portalId(payload.portalId)
  const scope = { kind: 'portal' as const, portalId: payload.portalId }
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'Portal Health notification has no eligible recipients',
    )
  }

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: 'portal.health_attention' as const,
          resourceType: 'portal' as const,
          resourceId: portal,
          eventId: event.eventId,
          payload: {},
          audience: {
            kind: 'portal_health' as const,
            portalId: portal,
            status: payload.status,
            reason: payload.reason,
            sourceVersion: payload.sourceVersion,
          },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PORTAL_HEALTH_CHANGED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerPortalHealthNotificationConsumer(
  registry: ConsumerRegistry,
  deps: PortalHealthNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'portal.health.changed',
    consumerName: 'notification.on-portal-health-changed',
    module: 'notification.portal-health-outbox-consumers',
    handler: (event) => handleNotificationPortalHealthChanged(deps, event),
  })
}
