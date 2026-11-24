import { createGoogleImportDispatchHandler } from './google-import-dispatch.server'
import type { GoogleImportQueuePort } from './google-import-queue.port.server'
import type { GoogleImportStore } from './import-store.port.server'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { GoogleImportReferenceStore } from './durable-import-reference-store.port.server'

export const PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER =
  'integration.provider-authorization-invalidation' as const

export function registerGoogleImportDispatchConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    store: GoogleImportStore
    queue: GoogleImportQueuePort
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
    references: Pick<
      GoogleImportReferenceStore,
      'invalidateProperty' | 'invalidateConnection'
    >
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
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
  const results = await Promise.all([
    deps.references.invalidateProperty({
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
    }),
    payload.change === 'relinked'
      ? Promise.resolve(true)
      : deps.references.invalidateConnection({
          organizationId: payload.organizationId,
          connectionId: payload.connectionId,
        }),
  ])
  if (results.some((result) => !result)) {
    throw new Error('Provider authorization invalidation failed')
  }
  await deps.receipts.insertReceipt(
    event.eventId,
    PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerProviderAuthorizationInvalidationConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    references: Pick<
      GoogleImportReferenceStore,
      'invalidateProperty' | 'invalidateConnection'
    >
    receipts: Pick<OutboxRepository, 'insertReceipt'>
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
