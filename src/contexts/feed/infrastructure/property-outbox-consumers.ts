import type { PropertyResponsibilityNeeded } from '#/contexts/property/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import type { PropertyPayloadDeps } from './notification-payload-facts'
import { enqueueResponsibilityGapNotification } from './responsibility-gap-notification'

export const ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-property-responsibility-needed' as const

export type PropertyNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: UserLookupPort
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Payload = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId?: string | null
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
  const needed: PropertyResponsibilityNeeded = {
    _tag: 'property.responsibility_became_needed',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    actorUserId: payload.actorUserId ? userId(payload.actorUserId) : null,
    occurredAt: new Date(payload.occurredAt),
  }
  await enqueueResponsibilityGapNotification(deps, needed, {
    kind: 'property',
    propertyId: needed.propertyId,
  })
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerPropertyNotificationConsumers(
  registry: ConsumerRegistry,
  deps: PropertyNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'property.responsibility_became_needed',
    consumerName: 'notification.on-property-responsibility-needed',
    module: 'notification.property-outbox-consumers',
    handler: (event) => handleNotificationPropertyResponsibilityNeeded(deps, event),
  })
}
