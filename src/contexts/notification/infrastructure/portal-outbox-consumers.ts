import { registerConsumer, type ConsumerEvent } from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  onPortalResponsibilityNeeded,
  type PortalResponsibilityNotificationDeps,
} from './event-handlers/on-portal-responsibility-needed'

export const ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-portal-responsibility-needed' as const

export type PortalNotificationConsumerDeps = PortalResponsibilityNotificationDeps &
  Readonly<{ receipts: Pick<OutboxRepository, 'insertReceipt'> }>

type Payload = Readonly<{
  portalId: string
  organizationId: string
  propertyId: string
  occurredAt: string
}>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'portal.responsibility_became_needed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('portal responsibility-needed envelope attribution mismatch')
  }
  return payload
}

export async function handleNotificationPortalResponsibilityNeeded(
  deps: PortalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  await onPortalResponsibilityNeeded(deps)({
    _tag: 'portal.responsibility_became_needed',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    portalId: portalId(payload.portalId),
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    occurredAt: new Date(payload.occurredAt),
  })
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerPortalNotificationConsumers(
  deps: PortalNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'portal.responsibility_became_needed',
    consumerName: 'notification.on-portal-responsibility-needed',
    module: 'notification.portal-outbox-consumers',
    handler: (event) => handleNotificationPortalResponsibilityNeeded(deps, event),
  })
}
