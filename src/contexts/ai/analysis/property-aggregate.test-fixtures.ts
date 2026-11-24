import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  ORGANIZATION_ID,
  PROPERTY_ID,
  SOURCE_EPOCH,
  SOURCE_REVISION,
  type REVIEW_A_ID,
} from './review-analysis-store.test-fixtures'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter.server'
import { readLockedAggregateHead } from './ai-property-aggregate-coverage.server'

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

export type AggregateWindowRequest = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  startLocalDate: string
  endLocalDate: string
}>

type DayCounts = {
  localDate: string
  reviewCount: number
  ratingSum: number
  sentimentCounts: Record<'positive' | 'neutral' | 'negative' | 'mixed', number>
  attentionCounts: Record<'urgent' | 'high' | 'medium' | 'low', number>
}

/**
 * The aggregate head, its coverage, and what each review's newest contribution puts
 * on a day, read as the suites need to see them. Null when the head is not there yet.
 */
export async function readAggregateWindow(db: Database, input: AggregateWindowRequest) {
  return db.transaction(async (tx) => {
    const locked = await readLockedAggregateHead(tx, input)
    if (locked === null) return null
    const rows = await tx.execute<{
      reviewId: string
      localDate: string
      rating: number
      sentiment: keyof DayCounts['sentimentCounts']
      attention: keyof DayCounts['attentionCounts']
    }>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (contribution.review_id) contribution.*
        FROM ai_property_aggregate_contributions AS contribution
        WHERE contribution.organization_id = ${input.organizationId}
          AND contribution.property_id = ${input.propertyId}::uuid
          AND contribution.source_epoch = ${input.sourceEpoch}
          AND contribution.review_analysis_epoch = ${input.reviewAnalysisEpoch}
          AND contribution.property_profile_version = ${input.propertyProfileVersion}
        ORDER BY contribution.review_id, contribution.analysis_sequence DESC
      )
      SELECT
        latest.review_id::text AS "reviewId",
        latest.local_date::text AS "localDate",
        latest.rating AS rating,
        latest.sentiment AS sentiment,
        latest.attention AS attention
      FROM latest
      WHERE latest.status = 'ready'
        AND latest.local_date BETWEEN ${input.startLocalDate}::date AND ${input.endLocalDate}::date
      ORDER BY latest.local_date, latest.review_id
    `)
    const days = new Map<string, DayCounts>()
    for (const row of rows.rows) {
      const day = days.get(row.localDate) ?? {
        localDate: row.localDate,
        reviewCount: 0,
        ratingSum: 0,
        sentimentCounts: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
        attentionCounts: { urgent: 0, high: 0, medium: 0, low: 0 },
      }
      day.reviewCount += 1
      day.ratingSum += row.rating
      day.sentimentCounts[row.sentiment] += 1
      day.attentionCounts[row.attention] += 1
      days.set(row.localDate, day)
    }
    return {
      head: locked.head,
      coverage: locked.coverage,
      days: [...days.values()],
      analyzedReviews: rows.rows.map((row) => ({ reviewId: row.reviewId })),
    }
  })
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
    readAggregateWindow(db, { ...AGGREGATE_WINDOW, ...overrides })

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
      aspects: [] as { aspect: string; polarity: string; mentionCount: number }[],
    }
  }

  return { apply, advanceWithoutAnalysis, readWindow, readDailyProjection }
}
