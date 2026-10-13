// Metric's own consumer of `metric.corrected`.
//
// Despite its name it reconciles nothing. It checks that the fact's envelope
// and payload name the same Organization and Property, and records a receipt.
// The reconciliation a correction needs is Goal's, the revision of closed
// monthly results, and `goal.metric-correction-reconciliation` does it
// (metric-correction-outbox-consumers.ts) and writes its own receipt. A
// receipt under this consumer's name therefore says that Metric saw a
// well-formed fact, never that the correction was reconciled.
//
// Nothing depends on it running. It is kept because its name is stored in
// `event_consumer_receipts` and is a row in both governance catalogues (the
// consumer in event-job-catalogue.ts, and `system:metric.record` in
// entry-point-catalogue.ts, an action no other entry point uses): removing it
// is a change to those tables, not a local edit.

import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerRegistry } from '#/shared/outbox'

const CORRECTION_RECONCILIATION_CONSUMER = 'metric.correction-reconciliation' as const
type MetricCorrectedPayload = Readonly<{
  correctionId: string
  correctedReadingId: string
  replacementReadingId: string | null
  organizationId: string
  propertyId: string
  definitionVersionId: string
  sourceEventId: string
  supersededSourceEventId: string
  occurredAt: string
}>

function parseMetricCorrectedPayload(
  eventVersion: number,
  payload: unknown,
): MetricCorrectedPayload {
  const validated = validateEventPayload('metric.corrected', eventVersion, payload)
  // validateEventPayload has applied the registered identifier-only Zod schema.
  return validated as MetricCorrectedPayload
}

export function registerMetricCorrectionConsumer(
  registry: ConsumerRegistry,
  db: Database,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'metric.corrected',
    consumerName: CORRECTION_RECONCILIATION_CONSUMER,
    module: CORRECTION_RECONCILIATION_CONSUMER,
    handler: async (event) => {
      const payload = parseMetricCorrectedPayload(event.eventVersion, event.payload)
      if (
        payload.organizationId !== event.organizationId ||
        payload.propertyId !== event.propertyId
      ) {
        throw new Error('metric correction envelope attribution mismatch')
      }

      const status = await db.transaction(async (tx) => {
        const reserved = await tx
          .insert(eventConsumerReceipts)
          .values({
            eventId: event.eventId,
            consumerName: CORRECTION_RECONCILIATION_CONSUMER,
            status: 'applied',
          })
          .onConflictDoNothing()
          .returning({ eventId: eventConsumerReceipts.eventId })
        if (reserved.length === 0) return 'duplicate' as const

        return 'applied' as const
      })
      return { status }
    },
  })
}
