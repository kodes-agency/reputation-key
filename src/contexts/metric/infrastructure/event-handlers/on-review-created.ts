// Metric context — records property.review metric on review creation events
import type { ReviewCreated } from '#/contexts/review/domain/events'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'

export type OnReviewCreatedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    try {
      await deps.recordMetric({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        portalId: null,
        metricKey: 'property.review',
        value: event.rating,
      })
    } catch (err) {
      getLogger().error(
        { err, event: event._tag, propertyId: event.propertyId },
        'metric: failed to record property.review',
      )
    }
  }
