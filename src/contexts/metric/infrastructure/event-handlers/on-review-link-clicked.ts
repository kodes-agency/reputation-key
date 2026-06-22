// Metric context — records portal.review_link_click metric on review link click events
import type { GuestReviewLinkClicked } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewLinkClickedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onReviewLinkClicked =
  (deps: OnReviewLinkClickedDeps) =>
  async (event: GuestReviewLinkClicked): Promise<void> => {
    return trace('metric.event.onReviewLinkClicked', async () => {
      try {
        await deps.recordMetric({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          portalId: event.portalId,
          metricKey: 'portal.review_link_click',
          value: 1,
          groupId: null,
        })
      } catch (err) {
        getLogger().error(
          { err, event: event._tag, portalId: event.portalId },
          'metric: failed to record portal.review_link_click',
        )
      }
    })
  }
