// Metric context — records portal.feedback metric on feedback submission events
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnFeedbackSubmittedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: GuestFeedbackSubmitted): Promise<void> => {
    return trace('metric.event.onFeedbackSubmitted', async () => {
      try {
        await deps.recordMetric({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          portalId: event.portalId,
          metricKey: 'portal.feedback',
          value: 1,
          groupId: null,
        })
      } catch (err) {
        getLogger().error(
          { err, event: event._tag, portalId: event.portalId },
          'metric: failed to record portal.feedback',
        )
      }
    })
  }
