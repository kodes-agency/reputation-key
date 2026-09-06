import type { PortalResponsibilityNeeded } from '#/contexts/portal/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-portal-responsibility-needed' as const

export type PortalNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

type Payload = Readonly<{
  portalId: string
  organizationId: string
  propertyId: string
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

async function enqueuePortalResponsibilityNotification(
  deps: PortalNotificationConsumerDeps,
  event: PortalResponsibilityNeeded,
): Promise<void> {
  const recipients = await deps.userLookup.findByRole(
    event.organizationId,
    'AccountAdmin',
  )
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'Portal responsibility notification has no AccountAdmin recipients',
    )
    return
  }
  await Promise.all(
    recipients.map((recipientId) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipientId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: 'portal.responsibility_needed',
          resourceType: 'portal',
          resourceId: event.portalId,
          eventId: event.eventId,
          payload: {},
          audience: { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}

export async function handleNotificationPortalResponsibilityNeeded(
  deps: PortalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  await enqueuePortalResponsibilityNotification(deps, {
    _tag: 'portal.responsibility_became_needed',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    portalId: portalId(payload.portalId),
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    sourceAggregateVersion: payload.sourceAggregateVersion,
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
