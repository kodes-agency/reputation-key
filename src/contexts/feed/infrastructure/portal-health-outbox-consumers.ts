import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import {
  isActionablePortalHealthReason,
  type PortalHealthReason,
  type PortalHealthStatus,
} from '../application/portal-health-notification'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

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

export type PortalHealthNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    logger: LoggerPort
  }>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'portal.health.changed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  // Organization and Property bind the fact's scope. The envelope aggregate is
  // not the Portal: the fact also names its Property, which the outbox ranks
  // first, so comparing the Portal id to it refused every real delivery.
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
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
): Promise<ConsumerResult> {
  const payload = parse(event)
  if (payload.status === 'healthy' || !isActionablePortalHealthReason(payload.reason)) {
    return deliverNotices(deps, event, ON_PORTAL_HEALTH_CHANGED_CONSUMER, [], {
      status: 'obsolete',
    })
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
  const where = await buildPropertyPayload(deps, organization, property)
  const status = payload.status
  const reason = payload.reason

  return deliverNotices(
    deps,
    event,
    ON_PORTAL_HEALTH_CHANGED_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: organization,
      propertyId: property,
      type: 'portal.health_attention' as const,
      resourceType: 'portal' as const,
      resourceId: portal,
      // Both facts are closed enums the event already carries. Without
      // them the notice could only say a portal "may need attention",
      // which is true of every cause and useful for none.
      payload: {
        ...where,
        portalHealthStatus: status,
        portalHealthReason: reason,
      },
      audience: {
        kind: 'portal_health' as const,
        portalId: portal,
        status,
        reason,
        // The fact occurs when the interval it opened takes effect.
        effectiveFrom: new Date(payload.occurredAt).toISOString(),
      },
    })),
  )
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
