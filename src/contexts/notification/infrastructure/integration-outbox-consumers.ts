import type { IntegrationGoogleAccountReauthorizationRequired } from '#/contexts/integration/application/public-api'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  type GoogleConnectionId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER =
  'notification.on-google-reauthorization-required' as const

export type GoogleConnectionPropertyLookup = Readonly<{
  findGoogleNotificationAnchor: (
    connectionId: GoogleConnectionId,
    organizationId: OrganizationId,
  ) => Promise<string | null>
}>

export type IntegrationNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

type Payload = Readonly<{
  connectionId: string
  organizationId: string
  cause: 'member_removed' | 'account_admin_role_lost'
  occurredAt: string
}>

function parse(event: ConsumerEvent): IntegrationGoogleAccountReauthorizationRequired {
  const payload = validateEventPayload(
    'integration.google_account.reauthorization_required',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Google reauthorization envelope attribution mismatch')
  }
  return {
    _tag: 'integration.google_account.reauthorization_required',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: organizationId(payload.organizationId),
    connectionId: googleConnectionId(payload.connectionId),
    cause: payload.cause,
    occurredAt: new Date(payload.occurredAt),
  }
}

export async function handleNotificationGoogleReauthorizationRequired(
  deps: IntegrationNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const fact = parse(event)
  const anchorPropertyId =
    await deps.googleConnectionProperties.findGoogleNotificationAnchor(
      fact.connectionId,
      fact.organizationId,
    )
  if (!anchorPropertyId) {
    deps.logger.warn(
      { correlationId: fact.correlationId ?? undefined },
      'Google reauthorization notification has no Property delivery scope',
    )
  } else {
    const recipients = await deps.userLookup.findByRole(
      fact.organizationId,
      'AccountAdmin',
    )
    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: fact.correlationId ?? undefined },
        'Google reauthorization notification has no AccountAdmin recipients',
      )
    } else {
      await Promise.all(
        recipients.map((recipientId) =>
          deps.queue.add(
            INSERT_NOTIFICATION_JOB_NAME,
            {
              userId: recipientId,
              organizationId: fact.organizationId,
              propertyId: propertyId(anchorPropertyId),
              type: 'integration.reauthorization_required',
              resourceType: 'integration',
              resourceId: fact.connectionId,
              eventId: fact.eventId,
              payload: {},
              audience: { kind: 'account_admin' },
            },
            { jobId: `${fact.eventId}-${recipientId}` },
          ),
        ),
      )
    }
  }
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerIntegrationNotificationConsumers(
  registry: ConsumerRegistry,
  deps: IntegrationNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'integration.google_account.reauthorization_required',
    consumerName: 'notification.on-google-reauthorization-required',
    module: 'notification.on-google-reauthorization-required',
    handler: (event) => handleNotificationGoogleReauthorizationRequired(deps, event),
  })
}
