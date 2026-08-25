import { organizationId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import type { PropertyGoogleBindingStore } from '../application/ports/property-google-binding.port'

const EVENT_TYPE = 'integration.property_import.retention_released'

type RetentionReleasedPayload = Readonly<{
  organizationId: string
  idempotencyKeys: readonly string[]
}>

function parsePayload(event: ConsumerEvent): RetentionReleasedPayload {
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    RetentionReleasedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('property import retention-release envelope attribution mismatch')
  }
  return payload
}

export async function handlePropertyRetentionReleased(
  store: PropertyGoogleBindingStore,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'duplicate' }>> {
  const payload = parsePayload(event)
  const releasedAt = new Date(event.recordedAt ?? '')
  if (Number.isNaN(releasedAt.getTime())) {
    throw new Error('property import retention-release recordedAt is invalid')
  }
  const status = await store.releaseRetentionFromEvent({
    eventId: event.eventId,
    organizationId: organizationId(payload.organizationId),
    idempotencyKeys: payload.idempotencyKeys,
    releasedAt,
  })
  return { status }
}

export function registerPropertyRetentionConsumer(
  store: PropertyGoogleBindingStore,
): void {
  registerConsumer({
    eventType: 'integration.property_import.retention_released',
    consumerName: 'property.import-retention-release',
    module: 'property.import-retention-release',
    handler: (event) => handlePropertyRetentionReleased(store, event),
  })
}
