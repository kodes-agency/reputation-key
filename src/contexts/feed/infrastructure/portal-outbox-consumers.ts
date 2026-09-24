import type { PortalResponsibilityNeeded } from '#/contexts/portal/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import type { PropertyPayloadDeps } from './notification-payload-facts'
import { enqueueResponsibilityGapNotification } from './responsibility-gap-notification'

export const ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-portal-responsibility-needed' as const

export type PortalNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: UserLookupPort
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
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
): Promise<Readonly<{ status: 'applied' }>> {
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
  await enqueueResponsibilityGapNotification(deps, needed, {
    kind: 'portal',
    portalId: needed.portalId,
  })
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
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
