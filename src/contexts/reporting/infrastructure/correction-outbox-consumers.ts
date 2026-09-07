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
