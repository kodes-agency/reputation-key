import type { PropertyResponsibilityNeeded } from '#/contexts/property/application/public-api'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'
import type { PropertyPayloadDeps } from './notification-payload-facts'
import { responsibilityGapNotices } from './responsibility-gap-notification'

export const ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-property-responsibility-needed' as const

export type PropertyNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    userLookup: UserLookupPort
    logger: LoggerPort
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
): Promise<ConsumerResult> {
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
  return deliverNotices(
    deps,
    event,
    ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
    await responsibilityGapNotices(deps, needed, {
      kind: 'property',
      propertyId: needed.propertyId,
    }),
  )
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
