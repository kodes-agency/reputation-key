import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ReconcileMetricCorrection } from '../application/use-cases/reconcile-metric-correction'

export const GOAL_METRIC_CORRECTION_CONSUMER =
  'goal.metric-correction-reconciliation' as const

export type GoalMetricCorrectionConsumerDeps = Readonly<{
  reconcile: ReconcileMetricCorrection
  db: Database
}>

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
  deps: GoalMetricCorrectionConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'metric.corrected',
    consumerName: 'goal.metric-correction-reconciliation',
    module: 'goal.metric-correction-reconciliation',
    handler: async (event) => {
      const payload = parseMetricCorrection(event)
      await deps.reconcile({
        organizationId: payload.organizationId,
        propertyId: payload.propertyId,
        definitionVersionId: payload.definitionVersionId,
        correctedReadingId: payload.correctedReadingId,
        replacementReadingId: payload.replacementReadingId,
      })
      // The receipt follows a complete pass and is not in one transaction with
      // it: each closed result is revised in its own compare-and-set, and a
      // pass over results already revised changes nothing. A crash before this
      // line therefore costs one more delivery, which finds every result
      // unchanged and writes the receipt. A pending result throws above, so no
      // receipt is written and the fact is delivered again. Without the
      // receipt the redelivery sweep dispatches the fact three more times and
      // then counts it as an exhausted delivery.
      await deps.db
        .insert(eventConsumerReceipts)
        .values({
          eventId: event.eventId,
          consumerName: GOAL_METRIC_CORRECTION_CONSUMER,
          status: 'applied',
        })
        .onConflictDoNothing()
      return { status: 'applied' }
    },
  })
}
