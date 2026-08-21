import { createGoogleImportDispatchHandler } from '../application/google-import-dispatch'
import type { GoogleImportV2QueuePort } from '../application/ports/gbp-queue.port'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import { registerConsumer } from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'

export function registerGoogleImportDispatchConsumer(
  deps: Readonly<{
    store: GoogleImportV2Store
    queue: GoogleImportV2QueuePort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
): void {
  registerConsumer({
    eventType: 'integration.property_import.requested',
    consumerName: 'integration.property-import-dispatch',
    module: 'integration.property-import-dispatch',
    handler: createGoogleImportDispatchHandler(deps),
  })
}
