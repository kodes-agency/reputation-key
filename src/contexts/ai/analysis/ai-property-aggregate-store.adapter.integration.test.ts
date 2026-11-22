import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiReviewAnalyses,
  outboxEvents,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { reviewId } from '#/shared/domain/ids'
import { ASPECT_TAXONOMY_V1 } from '#/shared/analysis/aspect-taxonomy'
import {
  CONTENT_EXPIRES_AT,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEWED_AT,
  REVIEW_A_ID,
  REVIEW_A_SOURCE_DIGEST,
  REVIEW_B_ID,
  SOURCE_BYTE_COUNT,
  SOURCE_EPOCH,
  SOURCE_REVISION,
  createReviewAnalysisStoreFixture,
} from './review-analysis-store.test-fixtures'
import type { AiOperationId } from '../domain/types'
import { createAggregateHelpers } from './property-aggregate.test-fixtures'
import { seedReviewContent } from './review-content.test-fixtures'

const SUPERSEDED_OPERATION_ID = '75000000-0000-4000-8000-000000000007' as AiOperationId
const LATEST_OPERATION_ID = '75000000-0000-4000-8000-000000000008' as AiOperationId
const SUPERSEDED_EVENT_ID = '75000000-0000-4000-8000-000000000009'
const LATEST_EVENT_ID = '75000000-0000-4000-8000-000000000010'

describe.sequential('AI output store analysis persistence (real PostgreSQL)', () => {
  const db = getDb()
  const { apply, advanceWithoutAnalysis, readWindow, readDailyProjection } =
    createAggregateHelpers(db)
  const fixture = createReviewAnalysisStoreFixture(db)
  const { seedStoredReviewA } = fixture

  beforeAll(fixture.install)
  beforeEach(fixture.resetBetweenTests)
  afterEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  })
  afterAll(fixture.remove)

  const clearAggregate = async () => {
    await db
      .delete(aiPropertyAggregateContributions)
      .where(eq(aiPropertyAggregateContributions.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
  }

  it('derives scalar day reads without reviving retired aspect writers', async () => {
    await seedStoredReviewA()
    await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 1,
    })
    await expect(readWindow()).resolves.toMatchObject({
      coverage: {
        settledAnalysisCount: 1,
        expectedAnalysisCount: 2,
        awaitingAnalysisCount: 1,
      },
      days: [{ localDate: '2026-09-07', reviewCount: 1 }],
      analyzedReviews: [{ reviewId: REVIEW_A_ID }],
    })
    await expect(advanceWithoutAnalysis(REVIEW_B_ID, 2)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 2,
    })

    const window = await readWindow()
    expect(window?.coverage).toEqual({
      settledAnalysisCount: 2,
      expectedAnalysisCount: 2,
      awaitingAnalysisCount: 0,
    })
    expect(window?.days).toEqual([
      expect.objectContaining({
        localDate: '2026-09-07',
        aspectCounts: [],
      }),
    ])
    expect(window?.analyzedReviews).toEqual([
      expect.objectContaining({
        reviewId: REVIEW_A_ID,
        aspects: [],
      }),
    ])
  })

  it('does not inherit coverage into a rolled property profile version', async () => {
    // A property timezone or country change bumps property_profile_version
    // WITHOUT bumping the review-analysis epoch. The settlement ledger is
    // deliberately profile-independent, but the daily aggregates and
    // contributions this coverage summarises are not: the new generation has
    // no rows yet. Coverage read from the ledger reported it complete over an
    // empty window, so the insights report showed a confidently empty period.
    await seedStoredReviewA()
    await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 1,
    })

    // Production reaches the rolled generation by settling into it. Use the
    // no-result path so the head is created exactly as a real profile bump
    // would create it, without needing a second stored analysis.
    await expect(advanceWithoutAnalysis(REVIEW_B_ID, 2, 2)).resolves.toMatchObject({
      status: 'applied',
    })

    const rolledWindow = await readWindow({ propertyProfileVersion: 2 })

    // Review A's analysis lives in profile generation 1 only, so generation 2
    // holds one settlement, not two. Reporting two would claim the window is
    // complete while its aspect rows are empty.
    expect(rolledWindow?.coverage.settledAnalysisCount).toBe(1)
    expect(rolledWindow?.coverage.awaitingAnalysisCount).toBe(1)
    expect(rolledWindow?.days ?? []).toEqual([])
  })

  it('reads current v1 analysis evidence that predates aspect children', async () => {
    await seedStoredReviewA()
    await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 1,
    })
    await expect(advanceWithoutAnalysis(REVIEW_B_ID, 2)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 2,
    })

    await db
      .update(aiReviewAnalyses)
      .set({ analysisProfileVersion: 'review-analysis-v1' })
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_A_ID))

    await expect(readWindow()).resolves.toMatchObject({
      days: [{ localDate: '2026-09-07', aspectCounts: [] }],
      analyzedReviews: [
        {
          reviewId: REVIEW_A_ID,
          analysisProfileVersion: 'review-analysis-v1',
          aspects: [],
        },
      ],
    })
  })

  it('converges for 20 different reviews applied in shuffled order', async () => {
    await db
      .update(reviewAiAnalysisHeads)
      .set({ headSequence: 40 })
      .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))

    const rows = Array.from({ length: 20 }, (_, index) => {
      const sequence = index + 21
      return {
        reviewId: reviewId(
          `75300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ),
        operationId: `75400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        eventId: `75500000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        sequence,
        rating: (index % 5) + 1,
        sentiment: ['positive', 'neutral', 'negative', 'mixed'][index % 4]!,
        attention: ['low', 'medium', 'high', 'urgent'][index % 4]!,
        aspect: ASPECT_TAXONOMY_V1[index % ASPECT_TAXONOMY_V1.length]!,
      }
    })
    await seedReviewContent(
      rows.map((row) => ({
        id: row.reviewId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google' as const,
        externalId: `aggregate-convergence-${row.sequence}`,
        reviewerName: `Convergence reviewer ${row.sequence}`,
        rating: row.rating,
        text: `Convergence review ${row.sequence}`,
        languageCode: 'en',
        reviewedAt: REVIEWED_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: row.sequence,
        aiSourceByteLength: SOURCE_BYTE_COUNT,
        aiSourceDigest: REVIEW_A_SOURCE_DIGEST,
        withMaterialRevision: true,
      })),
    )
    await fixture.cloneOperations(
      rows.map((row) => ({
        state: 'succeeded_pending_delivery',
        id: row.operationId as AiOperationId,
        reviewId: row.reviewId,
        originEventId: row.eventId,
        analysisSequence: row.sequence,
      })),
    )
    await fixture.insertAnalyses(
      rows.map((row) => ({
        reviewId: row.reviewId,
        analysisSequence: row.sequence,
        operationId: row.operationId,
        sentiment: row.sentiment,
        primaryCategory: row.aspect,
        attention: row.attention,
      })),
    )

    const snapshot = async () => {
      const { daily, aspects } = await readDailyProjection()
      const [head] = await db
        .select({
          aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
          terminalAnalysisSequence: aiPropertyAggregateHeads.terminalAnalysisSequence,
        })
        .from(aiPropertyAggregateHeads)
        .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
      const coverage = await db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM ai_property_aggregate_settlements
        WHERE organization_id = ${ORGANIZATION_ID}
          AND property_id = ${PROPERTY_ID}::uuid
          AND source_epoch = ${SOURCE_EPOCH}
          AND review_analysis_epoch = 1
      `)
      return {
        daily,
        aspects,
        head,
        settlementCount: coverage.rows[0]?.count,
      }
    }

    for (const row of rows) {
      await expect(apply(row.reviewId, row.sequence)).resolves.toMatchObject({
        status: 'applied',
      })
    }
    const sequential = await snapshot()

    await clearAggregate()
    const shuffled = [...rows].sort(
      (left, right) => ((left.sequence * 7) % 20) - ((right.sequence * 7) % 20),
    )
    for (const row of shuffled) {
      await expect(apply(row.reviewId, row.sequence)).resolves.toMatchObject({
        status: 'applied',
      })
    }

    expect(await snapshot()).toEqual(sequential)
    expect(sequential).toMatchObject({
      daily: { reviewCount: 20, ratingSum: 60 },
      head: { aggregateRevision: 20, terminalAnalysisSequence: 40 },
      settlementCount: 20,
    })
  })

  it('keeps the latest analysis when the same review settles out of order', async () => {
    await clearAggregate()
    await fixture.cloneOperations([
      {
        state: 'succeeded_pending_delivery',
        id: LATEST_OPERATION_ID,
        originEventId: LATEST_EVENT_ID,
        analysisSequence: 9,
      },
      {
        state: 'succeeded_pending_delivery',
        id: SUPERSEDED_OPERATION_ID,
        originEventId: SUPERSEDED_EVENT_ID,
        analysisSequence: 5,
      },
    ])
    await fixture.insertAnalyses([
      { reviewId: REVIEW_A_ID, analysisSequence: 9, operationId: LATEST_OPERATION_ID },
      {
        reviewId: REVIEW_A_ID,
        analysisSequence: 5,
        operationId: SUPERSEDED_OPERATION_ID,
        sentiment: 'negative',
        primaryCategory: 'quality',
        attention: 'urgent',
      },
    ])

    await db
      .update(reviews)
      .set({ analysisSequence: 9 })
      .where(eq(reviews.id, REVIEW_A_ID))
    await expect(apply(REVIEW_A_ID, 9)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 1,
    })

    const superseded = await apply(REVIEW_A_ID, 5)

    const { daily: projected } = await readDailyProjection()
    const daily = projected && {
      reviewCount: projected.reviewCount,
      ratingSum: projected.ratingSum,
      positiveCount: projected.positiveCount,
      negativeCount: projected.negativeCount,
      urgentCount: projected.urgentCount,
      lowCount: projected.lowCount,
    }
    expect(daily).toEqual({
      reviewCount: 1,
      ratingSum: 5,
      positiveCount: 1,
      negativeCount: 0,
      urgentCount: 0,
      lowCount: 1,
    })
    expect(superseded).toEqual({ status: 'stale' })
    await expect(apply(REVIEW_A_ID, 9)).resolves.toEqual({
      status: 'replayed',
      aggregateRevision: 1,
    })
    await expect(apply(REVIEW_A_ID, 5)).resolves.toEqual({ status: 'stale' })

    const settlements = await db
      .select({ analysisSequence: aiPropertyAggregateSettlements.analysisSequence })
      .from(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
      .orderBy(aiPropertyAggregateSettlements.analysisSequence)
    const [head] = await db
      .select({
        aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
        terminalAnalysisSequence: aiPropertyAggregateHeads.terminalAnalysisSequence,
      })
      .from(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
    expect(settlements).toEqual([{ analysisSequence: 5 }, { analysisSequence: 9 }])
    expect(head).toEqual({ aggregateRevision: 1, terminalAnalysisSequence: 9 })
  })
})
