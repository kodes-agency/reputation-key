import type { PropertyResponsibilityNeeded } from '#/contexts/property/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER =
  'notification.on-property-responsibility-needed' as const

export type PropertyNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

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

async function enqueuePropertyResponsibilityNotification(
  deps: PropertyNotificationConsumerDeps,
  event: PropertyResponsibilityNeeded,
): Promise<void> {
  const recipients = await deps.userLookup.findByRole(
    event.organizationId,
    'AccountAdmin',
  )
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'Property responsibility notification has no AccountAdmin recipients',
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
          type: 'property.responsibility_needed',
          resourceType: 'property',
          resourceId: event.propertyId,
          eventId: event.eventId,
          payload: {},
          audience: { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}

export async function handleNotificationPropertyResponsibilityNeeded(
  deps: PropertyNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  await enqueuePropertyResponsibilityNotification(deps, {
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
