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
import type { ReadingResult } from '../../domain/metric-reading'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export type OnReviewCreatedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<ReadingResult>
  reviewRatingLookup: ReviewRatingLookupPort
  logger: Pick<LoggerPort, 'error'>
}>

export type ProjectReviewCreatedMetricDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<ReadingResult>
  reviewRatingLookup: ReviewRatingLookupPort
}>

/**
 * Owner-authorized projection body shared by the low-latency bus path and the
 * durable repair path. It deliberately returns the Metric result so the
 * durable consumer can distinguish a replay from a rejected definition.
 */
export async function projectReviewCreatedMetric(
  deps: ProjectReviewCreatedMetricDeps,
  event: ReviewCreated,
): Promise<ReadingResult | null> {
  const rating = await deps.reviewRatingLookup.getEligibleRatingById(
    event.reviewId,
    event.organizationId,
  )
  if (rating === null) return null
  return deps.recordMetric({
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    portalId: null,
    portalGroupId: null,
    definitionVersionId: METRIC_VERSION_IDS.propertyReviewDashboard,
    sourceEventId: event.eventId,
    sourcePolicy: 'google_property_derivative',
    scope: 'property',
    value: rating,
    sampleCount: 1,
    occurredAt: event.occurredAt,
    attributionQuality: 'exact',
    sourceReceipt: {
      eventId: event.eventId,
      consumerName: 'metric.public-reputation',
    },
  })
}

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    return trace('metric.event.onReviewCreated', async () => {
      try {
        await projectReviewCreatedMetric(deps, event)
      } catch (err) {
        deps.logger.error(
          {
            err,
            event: event._tag,
          },
          'metric: failed to record property.review',
        )
      }
    })
  }
