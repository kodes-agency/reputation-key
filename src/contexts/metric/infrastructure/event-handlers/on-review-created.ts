// Metric context — records property.review metric on review creation events
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewCreatedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    return trace('metric.event.onReviewCreated', async () => {
      try {
        await deps.recordMetric({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          portalId: null,
          metricKey: 'property.review',
          value: event.rating,
          groupId: null,
        })
      } catch (err) {
        getLogger().error(
          { err, event: event._tag, propertyId: event.propertyId },
          'metric: failed to record property.review',
        )
      }
    })
  }
