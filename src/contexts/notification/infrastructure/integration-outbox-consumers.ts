import type { IntegrationGoogleAccountReauthorizationRequired } from '#/contexts/integration/application/public-api'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  registerConsumer,
  type ConsumerEvent,
  type OutboxRepository,
} from '#/shared/outbox'
import {
  onGoogleReauthorizationRequired,
  type GoogleReauthorizationNotificationDeps,
} from './event-handlers/on-google-reauthorization-required'

export const ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER =
  'notification.on-google-reauthorization-required' as const

export type IntegrationNotificationConsumerDeps = GoogleReauthorizationNotificationDeps &
  Readonly<{ receipts: Pick<OutboxRepository, 'insertReceipt'> }>

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
  await onGoogleReauthorizationRequired(deps)(parse(event))
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerIntegrationNotificationConsumers(
  deps: IntegrationNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'integration.google_account.reauthorization_required',
    consumerName: 'notification.on-google-reauthorization-required',
    module: 'notification.on-google-reauthorization-required',
    handler: (event) => handleNotificationGoogleReauthorizationRequired(deps, event),
  })
}
