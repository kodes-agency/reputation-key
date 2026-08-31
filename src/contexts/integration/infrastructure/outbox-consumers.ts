import { createGoogleImportDispatchHandler } from '../application/google-import-dispatch'
import type { GoogleImportV2QueuePort } from '../application/ports/gbp-queue.port'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ProviderAuthorizationInvalidationFanout } from '#/shared/provider-ephemeral/authorization-invalidation'

export const PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER =
  'integration.provider-authorization-invalidation' as const

export function registerGoogleImportDispatchConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    store: GoogleImportV2Store
    queue: GoogleImportV2QueuePort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'integration.property_import.requested',
    consumerName: 'integration.property-import-dispatch',
    module: 'integration.property-import-dispatch',
    handler: createGoogleImportDispatchHandler(deps),
  })
}

export async function handlePropertyBindingAuthorizationInvalidation(
  deps: Readonly<{
    fanout: ProviderAuthorizationInvalidationFanout
    receipts: Pick<OutboxRepository, 'insertReceipt'>
    nowMs: () => number
  }>,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'duplicate' | 'obsolete' }>> {
  const payload = validateEventPayload(
    'property.google_binding.changed',
    event.eventVersion,
    event.payload,
  ) as
    | Readonly<{
        organizationId: string
        propertyId: string
        connectionId: string
        sourceEpoch: number
        change: 'created' | 'relinked' | 'disconnected' | 'deletion_started'
      }>
    | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Provider authorization invalidation attribution mismatch')
  }
  if (payload.change === 'created') {
    await deps.receipts.insertReceipt(
      event.eventId,
      PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }
  const delivered = await deps.fanout.dispatch(
    {
      eventId: event.eventId,
      kind: 'property_binding_changed',
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      connectionId: payload.change === 'relinked' ? null : payload.connectionId,
      sourceEpoch: payload.sourceEpoch,
    },
    deps.nowMs(),
  )
  if (!delivered.ok) {
    throw new Error(`Provider authorization invalidation failed: ${delivered.code}`)
  }
  await deps.receipts.insertReceipt(
    event.eventId,
    PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
    delivered.status === 'duplicate' ? 'duplicate' : 'applied',
  )
  return { status: delivered.status === 'duplicate' ? 'duplicate' : 'applied' }
}

export function registerProviderAuthorizationInvalidationConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    fanout: ProviderAuthorizationInvalidationFanout
    receipts: Pick<OutboxRepository, 'insertReceipt'>
    nowMs: () => number
  }>,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'property.google_binding.changed',
    consumerName: 'integration.provider-authorization-invalidation',
    module: 'integration.property-import-dispatch',
    handler: (event) => handlePropertyBindingAuthorizationInvalidation(deps, event),
  })
}
