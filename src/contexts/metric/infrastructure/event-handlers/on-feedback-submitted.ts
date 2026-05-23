// Metric context — records portal.feedback metric on feedback submission events
import type { FeedbackSubmitted } from '#/contexts/guest/domain/events'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'

export type OnFeedbackSubmittedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: FeedbackSubmitted): Promise<void> => {
    try {
      await deps.recordMetric({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        portalId: event.portalId,
        metricKey: 'portal.feedback',
        value: 1,
        staffId: event.staffId,
      })
    } catch (err) {
      getLogger().error(
        { err, event: event._tag, portalId: event.portalId },
        'metric: failed to record portal.feedback',
      )
    }
  }
