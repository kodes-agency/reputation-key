import type {
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleAccountReauthorizationRequired,
} from '#/contexts/integration/application/public-api'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
  type GoogleConnectionId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER =
  'notification.on-google-reauthorization-required' as const

export const ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER =
  'notification.on-google-account-disconnected' as const

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
  cause: IntegrationGoogleAccountReauthorizationRequired['cause']
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
              payload: { reauthorizationCause: fact.cause },
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

type DisconnectedPayload = Readonly<{
  connectionId: string
  organizationId: string
  userId?: string | null
}>

/**
 * `userId` is the admin who disconnected; it is absent on facts the recovery
 * reconciler could not attribute and on facts recorded before the field
 * existed, and absent means nobody is excluded.
 */
function parseDisconnected(event: ConsumerEvent): IntegrationGoogleAccountDisconnected {
  const payload = validateEventPayload(
    'integration.google_account.disconnected',
    event.eventVersion,
    event.payload,
  ) as DisconnectedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Google disconnect envelope attribution mismatch')
  }
  const actor = payload.userId ?? null
  return {
    _tag: 'integration.google_account.disconnected',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: organizationId(payload.organizationId),
    connectionId: googleConnectionId(payload.connectionId),
    userId: actor === null ? null : userId(actor),
    // The disconnect fact carries no `occurredAt` of its own; the envelope's
    // is the only instant, and the notice never renders it anyway.
    occurredAt: new Date(event.occurredAt ?? event.recordedAt ?? 0),
  }
}

/**
 * A deliberate disconnect stops Google review updates and replies for the
 * whole Organization, and until now it said so nowhere: the only people who
 * could tell were the ones watching the Integrations page. The other
 * AccountAdmins are told; the one who did it is not, because nobody is
 * notified about their own action, and a fact that names no actor excludes
 * nobody rather than everybody.
 *
 * The notice is Organization-scoped: the connection belongs to the
 * Organization, so unlike `integration.reauthorization_required` it needs no
 * anchor Property to stand in for one (ADR 0046, amended 2026-09-24).
 */
export async function handleNotificationGoogleAccountDisconnected(
  deps: IntegrationNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const fact = parseDisconnected(event)
  const admins = await deps.userLookup.findByRole(fact.organizationId, 'AccountAdmin')
  const recipients = admins.filter((adminId) => adminId !== fact.userId)
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: fact.correlationId ?? undefined },
      'Google disconnect notification has no other AccountAdmin recipients',
    )
  } else {
    await Promise.all(
      recipients.map((recipientId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipientId,
            organizationId: fact.organizationId,
            propertyId: null,
            type: 'integration.google_disconnected',
            resourceType: 'integration',
            resourceId: fact.connectionId,
            eventId: fact.eventId,
            payload: {},
            audience: { kind: 'organization_account_admin' },
          },
          { jobId: `${fact.eventId}-${recipientId}` },
        ),
      ),
    )
  }
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
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
  registerConsumer({
    eventType: 'integration.google_account.disconnected',
    consumerName: ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
    module: ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
    handler: (event) => handleNotificationGoogleAccountDisconnected(deps, event),
  })
}
