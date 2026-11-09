import type { PortalResponsibilityNeeded } from '#/contexts/portal/application/public-api'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'
import type { PropertyPayloadDeps } from './notification-payload-facts'
import { responsibilityGapNotices } from './responsibility-gap-notification'

export const ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-portal-responsibility-needed' as const

export type PortalNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    userLookup: UserLookupPort
    logger: LoggerPort
  }>

type Payload = Readonly<{
  portalId: string
  organizationId: string
  propertyId: string
  actorUserId?: string | null
  sourceAggregateVersion?: string
  occurredAt: string
}>

function parse(
  event: ConsumerEvent,
): Payload & Readonly<{ sourceAggregateVersion: string }> {
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
  if (event.eventVersion === 1) {
    return { ...payload, sourceAggregateVersion: payload.occurredAt }
  }
  if (event.eventVersion !== 2 || !payload.sourceAggregateVersion) {
    throw new Error('portal responsibility-needed aggregate revision is missing')
  }
  return { ...payload, sourceAggregateVersion: payload.sourceAggregateVersion }
}

export async function handleNotificationPortalResponsibilityNeeded(
  deps: PortalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parse(event)
  const needed: PortalResponsibilityNeeded = {
    _tag: 'portal.responsibility_became_needed',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    portalId: portalId(payload.portalId),
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    actorUserId: payload.actorUserId ? userId(payload.actorUserId) : null,
    sourceAggregateVersion: payload.sourceAggregateVersion,
    occurredAt: new Date(payload.occurredAt),
  }
  return deliverNotices(
    deps,
    event,
    ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
    await responsibilityGapNotices(deps, needed, {
      kind: 'portal',
      portalId: needed.portalId,
    }),
  )
}

export function registerPortalNotificationConsumers(
  registry: ConsumerRegistry,
  deps: PortalNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'portal.responsibility_became_needed',
    consumerName: 'notification.on-portal-responsibility-needed',
    module: 'notification.portal-outbox-consumers',
    handler: (event) => handleNotificationPortalResponsibilityNeeded(deps, event),
  })
}
