import type { ReviewLinkClicked } from '#/contexts/guest/domain/events'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'

export type OnReviewLinkClickedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onReviewLinkClicked =
  (deps: OnReviewLinkClickedDeps) =>
  async (event: ReviewLinkClicked): Promise<void> => {
    try {
      await deps.recordMetric({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        portalId: event.portalId,
        metricKey: 'portal.review_link_click',
        value: 1,
      })
    } catch (err) {
      getLogger().error(
        { err, event: event._tag, portalId: event.portalId },
        'metric: failed to record portal.review_link_click',
      )
    }
  }
