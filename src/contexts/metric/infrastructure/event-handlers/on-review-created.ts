// Metric context — records property.review metric on review creation events
// property.review is a property-level metric: it carries no portalId, so it
// has no portal group association — groupId is always null here. (The four
// portal-scoped handlers resolve groupId via findGroupForPortal.)
//
// BQC-1.2: durable events are identifier-only — the rating is read at
// consume time via the authorized lookup. Expired/missing content records
// nothing (aggregates never resurrect ineligible content).
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type { ReviewRatingLookupPort } from '../../application/ports/review-rating-lookup.port'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewCreatedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
  reviewRatingLookup: ReviewRatingLookupPort
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    return trace('metric.event.onReviewCreated', async () => {
      try {
        const rating = await deps.reviewRatingLookup.getEligibleRatingById(
          event.reviewId,
          event.organizationId,
        )
        if (rating === null) return
        await deps.recordMetric({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          portalId: null,
          metricKey: 'property.review',
          value: rating,
          groupId: null,
        })
      } catch (err) {
        getLogger().error(
          {
            err,
            event: event._tag,
            propertyId: event.propertyId,
            organizationId: event.organizationId,
          },
          'metric: failed to record property.review',
        )
      }
    })
  }
