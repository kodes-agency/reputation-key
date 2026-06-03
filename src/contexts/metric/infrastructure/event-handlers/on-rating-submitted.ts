// Metric context — records portal.rating metric on rating submission events
import type { GuestRatingSubmitted } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'

export type OnRatingSubmittedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onRatingSubmitted =
  (deps: OnRatingSubmittedDeps) =>
  async (event: GuestRatingSubmitted): Promise<void> => {
    try {
      await deps.recordMetric({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        portalId: event.portalId,
        metricKey: 'portal.rating',
        value: event.value,
        groupId: null,
      })
    } catch (err) {
      getLogger().error(
        { err, event: event._tag, portalId: event.portalId },
        'metric: failed to record portal.rating',
      )
    }
  }
