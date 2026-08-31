import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ReconcileMetricCorrection } from '../application/use-cases/reconcile-metric-correction'

export const GOAL_METRIC_CORRECTION_CONSUMER =
  'goal.metric-correction-reconciliation' as const

type MetricCorrectedPayload = Readonly<{
  correctionId: string
  correctedReadingId: string
  replacementReadingId: string | null
  organizationId: string
  propertyId: string
  definitionVersionId: string
}>

function parseMetricCorrection(event: ConsumerEvent): MetricCorrectedPayload {
  const payload = validateEventPayload(
    'metric.corrected',
    event.eventVersion,
    event.payload,
  ) as MetricCorrectedPayload | undefined
  if (
    !payload ||
    event.propertyId === null ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Goal metric-correction envelope attribution mismatch')
  }
  return payload
}

export function registerGoalMetricCorrectionConsumer(
  registry: ConsumerRegistry,
  reconcile: ReconcileMetricCorrection,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'metric.corrected',
    consumerName: 'goal.metric-correction-reconciliation',
    module: 'goal.metric-correction-reconciliation',
    handler: async (event) => {
      const payload = parseMetricCorrection(event)
      await reconcile({
        organizationId: payload.organizationId,
        propertyId: payload.propertyId,
        definitionVersionId: payload.definitionVersionId,
        correctedReadingId: payload.correctedReadingId,
        replacementReadingId: payload.replacementReadingId,
      })
      return { status: 'applied' }
    },
  })
}
