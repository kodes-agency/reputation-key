import type { Database } from '#/shared/db'
import { lte } from 'drizzle-orm'
import { metricSourceWatermarks } from '#/shared/db/schema/metric.schema'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { registerConsumer } from '#/shared/outbox/dispatcher'

type MetricCorrectedPayload = Readonly<{
  correctionId: string
  correctedReadingId: string
  replacementReadingId: string
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

export function registerMetricCorrectionConsumer(db: Database): void {
  registerConsumer({
    eventType: 'metric.corrected',
    consumerName: 'metric.correction-reconciliation',
    module: 'metric.correction-reconciliation',
    handler: async (event) => {
      const payload = parseMetricCorrectedPayload(event.eventVersion, event.payload)
      if (
        payload.organizationId !== event.organizationId ||
        payload.propertyId !== event.propertyId
      ) {
        throw new Error('metric correction envelope attribution mismatch')
      }
      const occurredAt = new Date(payload.occurredAt)
      if (Number.isNaN(occurredAt.getTime())) {
        throw new Error('metric correction occurredAt is invalid')
      }
      await db
        .insert(metricSourceWatermarks)
        .values({
          consumerName: 'metric.correction-reconciliation',
          sourceName: 'portal.workflow',
          organizationId: payload.organizationId,
          propertyId: payload.propertyId,
          definitionVersionId: payload.definitionVersionId,
          lastSourceEventId: payload.sourceEventId,
          lastEventAt: occurredAt,
          updatedAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: [
            metricSourceWatermarks.consumerName,
            metricSourceWatermarks.sourceName,
            metricSourceWatermarks.organizationId,
            metricSourceWatermarks.propertyId,
            metricSourceWatermarks.definitionVersionId,
          ],
          set: {
            lastSourceEventId: payload.sourceEventId,
            lastEventAt: occurredAt,
            updatedAt: occurredAt,
          },
          setWhere: lte(metricSourceWatermarks.lastEventAt, occurredAt),
        })
      return { status: 'applied' }
    },
  })
}
