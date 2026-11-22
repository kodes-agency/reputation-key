import type { Database } from '#/shared/db'
import {
  ORGANIZATION_ID,
  PROPERTY_ID,
  SOURCE_EPOCH,
  SOURCE_REVISION,
  type REVIEW_A_ID,
} from './review-analysis-store.test-fixtures'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter.server'

/** The one local day the suites' reviews were written on. */
export const AGGREGATE_WINDOW = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  sourceEpoch: SOURCE_EPOCH,
  reviewAnalysisEpoch: 1,
  propertyProfileVersion: 1,
  startLocalDate: '2026-09-07',
  endLocalDate: '2026-09-07',
}

/** The Property aggregate store with its calls pinned to the shared fixture's Property. */
export function createAggregateHelpers(db: Database) {
  const aggregates = createAiPropertyAggregateStoreAdapter(db)

  const apply = (review: typeof REVIEW_A_ID, analysisSequence: number) =>
    aggregates.applyReviewAnalysis({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: review,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      calendarProfileVersion: 'property-calendar-v1',
    })

  const advanceWithoutAnalysis = (
    review: typeof REVIEW_A_ID,
    analysisSequence: number,
    propertyProfileVersion = 1,
  ) =>
    aggregates.advanceWithoutAnalysis({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: review,
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: 1,
      analysisSequence,
      propertyProfileVersion,
      dispositionCode: 'provider_deleted',
    })

  const readWindow = (overrides: Partial<typeof AGGREGATE_WINDOW> = {}) =>
    aggregates.readWindow({ ...AGGREGATE_WINDOW, ...overrides })

  const readDailyProjection = async () => {
    const day = (await readWindow())?.days[0]
    return {
      daily: day && {
        reviewCount: day.reviewCount,
        ratingSum: day.ratingSum,
        positiveCount: day.sentimentCounts.positive,
        neutralCount: day.sentimentCounts.neutral,
        negativeCount: day.sentimentCounts.negative,
        mixedCount: day.sentimentCounts.mixed,
        urgentCount: day.attentionCounts.urgent,
        highCount: day.attentionCounts.high,
        mediumCount: day.attentionCounts.medium,
        lowCount: day.attentionCounts.low,
      },
      aspects:
        day?.aspectCounts.map((row) => ({
          aspect: row.aspect,
          polarity: row.polarity,
          mentionCount: row.count,
        })) ?? [],
    }
  }

  return { apply, advanceWithoutAnalysis, readWindow, readDailyProjection }
}
