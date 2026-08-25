import { registerConsumer, type ConsumerEvent } from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  onPropertyResponsibilityNeeded,
  type PropertyResponsibilityNotificationDeps,
} from './event-handlers/on-property-responsibility-needed'

export const ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-property-responsibility-needed' as const

export type PropertyNotificationConsumerDeps = PropertyResponsibilityNotificationDeps &
  Readonly<{ receipts: Pick<OutboxRepository, 'insertReceipt'> }>

type Payload = Readonly<{
  organizationId: string
  propertyId: string
  occurredAt: string
}>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'property.responsibility_became_needed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Property responsibility-needed envelope attribution mismatch')
  }
  return payload
}

export async function handleNotificationPropertyResponsibilityNeeded(
  deps: PropertyNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  await onPropertyResponsibilityNeeded(deps)({
    _tag: 'property.responsibility_became_needed',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    occurredAt: new Date(payload.occurredAt),
  })
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerPropertyNotificationConsumers(
  deps: PropertyNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'property.responsibility_became_needed',
    consumerName: 'notification.on-property-responsibility-needed',
    module: 'notification.property-outbox-consumers',
    handler: (event) => handleNotificationPropertyResponsibilityNeeded(deps, event),
  })
}
