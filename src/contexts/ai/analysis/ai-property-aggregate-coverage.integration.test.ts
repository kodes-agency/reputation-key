import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiOperations,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiReviewAnalyses,
  outboxEvents,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import {
  COMPLETED_AT,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_A_ID,
  REVIEW_B_ID,
  SOURCE_EPOCH,
  createReviewAnalysisStoreFixture,
} from './review-analysis-store.test-fixtures'
import type { AiOperationId } from '../domain/types'
import { createAggregateHelpers } from './property-aggregate.test-fixtures'

describe.sequential('AI output store analysis persistence (real PostgreSQL)', () => {
  const db = getDb()
  const { apply, advanceWithoutAnalysis, readWindow, readDailyProjection } =
    createAggregateHelpers(db)
  const fixture = createReviewAnalysisStoreFixture(db)

  beforeAll(fixture.install)
  beforeEach(fixture.resetBetweenTests)
  afterEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  })
  afterAll(fixture.remove)

  describe('aggregate coverage and withdrawal across the sequences of a review', () => {
    const seededOperationIds: AiOperationId[] = []

    const operationIdFor = (sequence: number) =>
      `75600000-0000-4000-8000-${String(sequence).padStart(12, '0')}` as AiOperationId

    /** A stored, delivered analysis of one review at one sequence. */
    const seedAnalysis = async (review: typeof REVIEW_A_ID, sequence: number) => {
      const operationId = operationIdFor(sequence)
      await fixture.cloneOperation({
        id: operationId,
        originEventId: `75700000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        reviewId: review,
        analysisSequence: sequence,
        state: 'succeeded_pending_delivery',
      })
      seededOperationIds.push(operationId)
      await fixture.insertAnalyses([
        { reviewId: review, analysisSequence: sequence, operationId },
      ])
    }

    /** The review as its source now stands, and how far the Property has allocated. */
    const setSequences = async (
      current: Readonly<{ review: typeof REVIEW_A_ID; sequence: number }>,
      headSequence: number,
    ) => {
      await db
        .update(reviews)
        .set({ analysisSequence: current.sequence })
        .where(eq(reviews.id, current.review))
      await db
        .update(reviewAiAnalysisHeads)
        .set({ headSequence })
        .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
    }

    /** What the head says was settled, and what the ledger says was. */
    const settledCounts = async () => {
      const [head] = await db
        .select({
          settledAnalysisCount: aiPropertyAggregateHeads.settledAnalysisCount,
          aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
        })
        .from(aiPropertyAggregateHeads)
        .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
      const ledger = await db
        .select({ analysisSequence: aiPropertyAggregateSettlements.analysisSequence })
        .from(aiPropertyAggregateSettlements)
        .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
      return {
        headCounter: head?.settledAnalysisCount,
        ledgerRows: ledger.length,
        aggregateRevision: head?.aggregateRevision,
      }
    }

    /**
     * A ledger row the head never counted: what a stale settlement left behind
     * before the head counted it with the ledger. Written directly because the
     * code under test no longer makes one.
     */
    const seedUncountedSettlement = (review: typeof REVIEW_A_ID, sequence: number) =>
      db.insert(aiPropertyAggregateSettlements).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: review,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        analysisSequence: sequence,
        settledAt: COMPLETED_AT,
      })

    /** The counter of each profile generation's head, by profile version. */
    const headCountersByProfile = async () =>
      Object.fromEntries(
        (
          await db
            .select({
              version: aiPropertyAggregateHeads.propertyProfileVersion,
              counter: aiPropertyAggregateHeads.settledAnalysisCount,
            })
            .from(aiPropertyAggregateHeads)
            .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
        ).map((head) => [head.version, head.counter]),
      )

    const dailyTotals = async () => {
      const { daily, aspects } = await readDailyProjection()
      return {
        reviewCount: daily?.reviewCount,
        ratingSum: daily?.ratingSum,
        serviceMentions:
          aspects.find((row) => row.aspect === 'service')?.mentionCount ?? 0,
      }
    }

    beforeEach(async () => {
      await db
        .delete(aiPropertyAggregateContributions)
        .where(eq(aiPropertyAggregateContributions.propertyId, PROPERTY_ID))
    })

    afterEach(async () => {
      await db
        .delete(aiReviewAnalyses)
        .where(eq(aiReviewAnalyses.propertyId, PROPERTY_ID))
      await db
        .delete(aiOperations)
        .where(inArray(aiOperations.id, seededOperationIds.splice(0)))
      await db
        .update(reviews)
        .set({ analysisSequence: 2 })
        .where(eq(reviews.id, REVIEW_B_ID))
      await db
        .update(reviewAiAnalysisHeads)
        .set({ headSequence: 2 })
        .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
    })

    it('counts the older sequence of an edited review that its newer sequence has superseded', async () => {
      await seedAnalysis(REVIEW_A_ID, 1)
      await seedAnalysis(REVIEW_A_ID, 2)
      await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)

      await expect(apply(REVIEW_A_ID, 2)).resolves.toEqual({
        status: 'applied',
        aggregateRevision: 1,
      })
      await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })

      await expect(settledCounts()).resolves.toEqual({
        headCounter: 2,
        ledgerRows: 2,
        aggregateRevision: 1,
      })
      await expect(readWindow()).resolves.toMatchObject({
        coverage: {
          settledAnalysisCount: 2,
          expectedAnalysisCount: 2,
          awaitingAnalysisCount: 0,
        },
        days: [{ localDate: '2026-09-07', reviewCount: 1 }],
      })
    })

    it('counts a sequence whose review had moved on before the analysis was applied', async () => {
      await seedAnalysis(REVIEW_A_ID, 1)
      await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)

      await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })

      await expect(settledCounts()).resolves.toMatchObject({
        headCounter: 1,
        ledgerRows: 1,
      })
      await expect(readWindow()).resolves.toMatchObject({
        coverage: {
          settledAnalysisCount: 1,
          expectedAnalysisCount: 2,
          awaitingAnalysisCount: 1,
        },
      })
    })

    it('counts a no-result sequence that a newer sequence of the same review superseded', async () => {
      await seedAnalysis(REVIEW_A_ID, 2)
      await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)

      await expect(apply(REVIEW_A_ID, 2)).resolves.toMatchObject({ status: 'applied' })
      await expect(advanceWithoutAnalysis(REVIEW_A_ID, 1)).resolves.toEqual({
        status: 'stale',
      })

      await expect(settledCounts()).resolves.toEqual({
        headCounter: 2,
        ledgerRows: 2,
        aggregateRevision: 1,
      })
      await expect(dailyTotals()).resolves.toEqual({
        reviewCount: 1,
        ratingSum: 5,
        serviceMentions: 0,
      })
    })

    it('takes a review off the day when its next sequence settles without a result', async () => {
      await seedAnalysis(REVIEW_A_ID, 1)
      await seedAnalysis(REVIEW_B_ID, 2)
      await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 3)
      await expect(apply(REVIEW_A_ID, 1)).resolves.toMatchObject({ status: 'applied' })
      await expect(apply(REVIEW_B_ID, 2)).resolves.toMatchObject({ status: 'applied' })
      await expect(dailyTotals()).resolves.toEqual({
        reviewCount: 2,
        ratingSum: 9,
        serviceMentions: 0,
      })

      // Google deletes review A: its next sequence settles with no result.
      await setSequences({ review: REVIEW_A_ID, sequence: 3 }, 3)
      await expect(advanceWithoutAnalysis(REVIEW_A_ID, 3)).resolves.toEqual({
        status: 'applied',
        aggregateRevision: 3,
      })

      await expect(dailyTotals()).resolves.toEqual({
        reviewCount: 1,
        ratingSum: 4,
        serviceMentions: 0,
      })
      const window = await readWindow()
      expect(window?.analyzedReviews.map((review) => review.reviewId)).toEqual([
        REVIEW_B_ID,
      ])
      expect(window?.coverage).toEqual({
        settledAnalysisCount: 3,
        expectedAnalysisCount: 3,
        awaitingAnalysisCount: 0,
      })
    })

    it('does not take a withdrawn review off the day twice when it is analysed again', async () => {
      await seedAnalysis(REVIEW_A_ID, 1)
      await seedAnalysis(REVIEW_B_ID, 2)
      await seedAnalysis(REVIEW_A_ID, 4)
      await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 4)
      await apply(REVIEW_A_ID, 1)
      await apply(REVIEW_B_ID, 2)
      await advanceWithoutAnalysis(REVIEW_A_ID, 3)

      // The review is back (a new revision with text): sequence 4 is analysed.
      await setSequences({ review: REVIEW_A_ID, sequence: 4 }, 4)
      await expect(apply(REVIEW_A_ID, 4)).resolves.toMatchObject({ status: 'applied' })

      await expect(dailyTotals()).resolves.toEqual({
        reviewCount: 2,
        ratingSum: 9,
        serviceMentions: 0,
      })
      const window = await readWindow()
      expect(window?.analyzedReviews.map((review) => review.reviewId).sort()).toEqual(
        [REVIEW_A_ID, REVIEW_B_ID].sort(),
      )
      await expect(settledCounts()).resolves.toMatchObject({
        headCounter: 4,
        ledgerRows: 4,
      })
    })

    it('leaves a review that never had a contribution untouched when it settles without a result', async () => {
      await seedAnalysis(REVIEW_A_ID, 1)
      await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 3)
      await apply(REVIEW_A_ID, 1)

      await expect(advanceWithoutAnalysis(REVIEW_B_ID, 2)).resolves.toMatchObject({
        status: 'applied',
      })

      await expect(dailyTotals()).resolves.toEqual({
        reviewCount: 1,
        ratingSum: 5,
        serviceMentions: 0,
      })
    })

    describe('a head that already missed a stale sequence before the head counted it', () => {
      it('is brought back to the ledger when the next sequence is applied', async () => {
        await seedAnalysis(REVIEW_A_ID, 2)
        await seedAnalysis(REVIEW_B_ID, 3)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 3)
        await apply(REVIEW_A_ID, 2)
        await seedUncountedSettlement(REVIEW_A_ID, 1)
        await expect(settledCounts()).resolves.toMatchObject({
          headCounter: 1,
          ledgerRows: 2,
        })

        await setSequences({ review: REVIEW_B_ID, sequence: 3 }, 3)
        await expect(apply(REVIEW_B_ID, 3)).resolves.toMatchObject({ status: 'applied' })

        await expect(settledCounts()).resolves.toEqual({
          headCounter: 3,
          ledgerRows: 3,
          aggregateRevision: 2,
        })
        await expect(readWindow()).resolves.toMatchObject({
          coverage: {
            settledAnalysisCount: 3,
            expectedAnalysisCount: 3,
            awaitingAnalysisCount: 0,
          },
        })
      })

      it('is brought back to the ledger when the next settlement is itself stale', async () => {
        await seedAnalysis(REVIEW_A_ID, 3)
        await setSequences({ review: REVIEW_A_ID, sequence: 3 }, 3)
        await apply(REVIEW_A_ID, 3)
        await seedUncountedSettlement(REVIEW_A_ID, 1)

        await expect(advanceWithoutAnalysis(REVIEW_A_ID, 2)).resolves.toEqual({
          status: 'stale',
        })

        await expect(settledCounts()).resolves.toEqual({
          headCounter: 3,
          ledgerRows: 3,
          aggregateRevision: 1,
        })
        await expect(readWindow()).resolves.toMatchObject({
          coverage: { awaitingAnalysisCount: 0 },
        })
      })

      it('does not complete a rolled profile generation from the ledger of the one before', async () => {
        await seedAnalysis(REVIEW_A_ID, 1)
        await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 2)
        await apply(REVIEW_A_ID, 1)

        // The Property's profile rolls: the next settlement opens a second
        // generation, whose window holds nothing until it is rebuilt.
        await expect(advanceWithoutAnalysis(REVIEW_B_ID, 2, 2)).resolves.toMatchObject({
          status: 'applied',
        })

        await expect(headCountersByProfile()).resolves.toEqual({ 1: 1, 2: 1 })
        await expect(settledCounts()).resolves.toMatchObject({ ledgerRows: 2 })
      })
    })

    // The statements docs/operations/runbooks.md §22 hands the operator for data
    // written before the head counted every sequence. They are the runbook's
    // statements, word for word apart from layout: change one and change both,
    // so the runbook cannot describe a statement that does not work.
    describe('the operator statements for data written before this change', () => {
      /** Heads that are the only head of their epoch and count another number of sequences than the ledger holds. */
      const DRIFTED_HEADS = `
        SELECT head.organization_id, head.property_id, head.review_analysis_epoch,
               head.settled_analysis_count AS head_counted, ledger.ledger_rows
        FROM ai_property_aggregate_heads AS head
        JOIN (
          SELECT organization_id, property_id, source_epoch, review_analysis_epoch,
                 count(*) AS ledger_rows
          FROM ai_property_aggregate_settlements
          GROUP BY organization_id, property_id, source_epoch, review_analysis_epoch
        ) AS ledger
          ON ledger.organization_id = head.organization_id
         AND ledger.property_id = head.property_id
         AND ledger.source_epoch = head.source_epoch
         AND ledger.review_analysis_epoch = head.review_analysis_epoch
        WHERE head.settled_analysis_count <> ledger.ledger_rows
          AND NOT EXISTS (
            SELECT 1 FROM ai_property_aggregate_heads AS sibling
            WHERE sibling.organization_id = head.organization_id
              AND sibling.property_id = head.property_id
              AND sibling.source_epoch = head.source_epoch
              AND sibling.review_analysis_epoch = head.review_analysis_epoch
              AND sibling.property_profile_version <> head.property_profile_version)`
      const RECOUNT_DRIFTED_HEADS = `
        UPDATE ai_property_aggregate_heads AS head
        SET settled_analysis_count = ledger.ledger_rows, updated_at = now()
        FROM (
          SELECT organization_id, property_id, source_epoch, review_analysis_epoch,
                 count(*) AS ledger_rows
          FROM ai_property_aggregate_settlements
          GROUP BY organization_id, property_id, source_epoch, review_analysis_epoch
        ) AS ledger
        WHERE ledger.organization_id = head.organization_id
          AND ledger.property_id = head.property_id
          AND ledger.source_epoch = head.source_epoch
          AND ledger.review_analysis_epoch = head.review_analysis_epoch
          AND head.settled_analysis_count < ledger.ledger_rows
          AND NOT EXISTS (
            SELECT 1 FROM ai_property_aggregate_heads AS sibling
            WHERE sibling.organization_id = head.organization_id
              AND sibling.property_id = head.property_id
              AND sibling.source_epoch = head.source_epoch
              AND sibling.review_analysis_epoch = head.review_analysis_epoch
              AND sibling.property_profile_version <> head.property_profile_version)`
      /** A review's current contribution that a newer settled sequence of the review no longer supports. */
      const UNWITHDRAWN_CONTRIBUTIONS = `
        SELECT contribution.organization_id, contribution.property_id, contribution.review_id,
               contribution.analysis_sequence AS contributed_sequence,
               latest.analysis_sequence AS latest_settled_sequence
        FROM ai_property_aggregate_contributions AS contribution
        JOIN LATERAL (
          SELECT max(settlement.analysis_sequence) AS analysis_sequence
          FROM ai_property_aggregate_settlements AS settlement
          WHERE settlement.organization_id = contribution.organization_id
            AND settlement.property_id = contribution.property_id
            AND settlement.review_id = contribution.review_id
            AND settlement.source_epoch = contribution.source_epoch
            AND settlement.review_analysis_epoch = contribution.review_analysis_epoch
        ) AS latest ON true
        WHERE contribution.status = 'ready'
          AND latest.analysis_sequence > contribution.analysis_sequence
          AND contribution.property_profile_version = (
            SELECT max(head.property_profile_version)
            FROM ai_property_aggregate_heads AS head
            WHERE head.organization_id = contribution.organization_id
              AND head.property_id = contribution.property_id
              AND head.source_epoch = contribution.source_epoch
              AND head.review_analysis_epoch = contribution.review_analysis_epoch)
          AND NOT EXISTS (
            SELECT 1 FROM ai_property_aggregate_contributions AS newer
            WHERE newer.organization_id = contribution.organization_id
              AND newer.property_id = contribution.property_id
              AND newer.review_id = contribution.review_id
              AND newer.source_epoch = contribution.source_epoch
              AND newer.review_analysis_epoch = contribution.review_analysis_epoch
              AND newer.property_profile_version = contribution.property_profile_version
              AND newer.analysis_sequence > contribution.analysis_sequence)`

      const run = async (statement: string) => (await db.execute(sql.raw(statement))).rows

      it('finds a head that is short of the ledger and recounts it', async () => {
        await seedAnalysis(REVIEW_A_ID, 2)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)
        await apply(REVIEW_A_ID, 2)
        await seedUncountedSettlement(REVIEW_A_ID, 1)

        await expect(run(DRIFTED_HEADS)).resolves.toEqual([
          expect.objectContaining({ head_counted: '1', ledger_rows: '2' }),
        ])
        await run(RECOUNT_DRIFTED_HEADS)

        await expect(headCountersByProfile()).resolves.toEqual({ 1: 2 })
        await expect(run(DRIFTED_HEADS)).resolves.toEqual([])
        await expect(readWindow()).resolves.toMatchObject({
          coverage: { awaitingAnalysisCount: 0 },
        })
      })

      it('leaves the heads of a rolled profile alone, whose counters are not the ledger', async () => {
        await seedAnalysis(REVIEW_A_ID, 1)
        await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 2)
        await apply(REVIEW_A_ID, 1)
        await advanceWithoutAnalysis(REVIEW_B_ID, 2, 2)

        await expect(run(DRIFTED_HEADS)).resolves.toEqual([])
        await run(RECOUNT_DRIFTED_HEADS)

        await expect(headCountersByProfile()).resolves.toEqual({ 1: 1, 2: 1 })
      })

      it('finds a review whose newer sequence settled without taking it off its day, and not once it is withdrawn', async () => {
        await seedAnalysis(REVIEW_A_ID, 1)
        await setSequences({ review: REVIEW_A_ID, sequence: 1 }, 2)
        await apply(REVIEW_A_ID, 1)
        // What the no-result path left behind before it withdrew: the ledger row
        // and nothing else.
        await seedUncountedSettlement(REVIEW_A_ID, 2)

        await expect(run(UNWITHDRAWN_CONTRIBUTIONS)).resolves.toEqual([
          expect.objectContaining({
            review_id: REVIEW_A_ID,
            contributed_sequence: '1',
            latest_settled_sequence: '2',
          }),
        ])

        await db
          .delete(aiPropertyAggregateSettlements)
          .where(
            and(
              eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID),
              eq(aiPropertyAggregateSettlements.analysisSequence, 2),
            ),
          )
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)
        await advanceWithoutAnalysis(REVIEW_A_ID, 2)

        await expect(run(UNWITHDRAWN_CONTRIBUTIONS)).resolves.toEqual([])
      })
    })

    describe('replaying a settlement', () => {
      it('counts a stale older sequence once, so coverage still resolves', async () => {
        await seedAnalysis(REVIEW_A_ID, 1)
        await seedAnalysis(REVIEW_A_ID, 2)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)
        await apply(REVIEW_A_ID, 2)

        await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })
        await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })

        await expect(settledCounts()).resolves.toEqual({
          headCounter: 2,
          ledgerRows: 2,
          aggregateRevision: 1,
        })
        await expect(readWindow()).resolves.toMatchObject({
          coverage: {
            settledAnalysisCount: 2,
            expectedAnalysisCount: 2,
            awaitingAnalysisCount: 0,
          },
        })
      })

      it('counts a superseded no-result sequence once, so coverage still resolves', async () => {
        await seedAnalysis(REVIEW_A_ID, 2)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)
        await apply(REVIEW_A_ID, 2)

        await expect(advanceWithoutAnalysis(REVIEW_A_ID, 1)).resolves.toEqual({
          status: 'stale',
        })
        await expect(advanceWithoutAnalysis(REVIEW_A_ID, 1)).resolves.toEqual({
          status: 'stale',
        })

        await expect(settledCounts()).resolves.toEqual({
          headCounter: 2,
          ledgerRows: 2,
          aggregateRevision: 1,
        })
        await expect(readWindow()).resolves.toMatchObject({
          coverage: { settledAnalysisCount: 2, awaitingAnalysisCount: 0 },
        })
      })

      it('counts a stale sequence once in a rolled profile generation', async () => {
        await seedAnalysis(REVIEW_A_ID, 2)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)
        await apply(REVIEW_A_ID, 2)

        // The generation after the roll counts its own settlements: it has a
        // sibling, so the ledger cannot be used to recount it.
        await expect(advanceWithoutAnalysis(REVIEW_A_ID, 1, 2)).resolves.toEqual({
          status: 'stale',
        })
        await expect(advanceWithoutAnalysis(REVIEW_A_ID, 1, 2)).resolves.toEqual({
          status: 'stale',
        })

        await expect(headCountersByProfile()).resolves.toEqual({ 1: 1, 2: 1 })
        await expect(settledCounts()).resolves.toMatchObject({ ledgerRows: 2 })
      })

      it('counts a sequence whose review had moved on once, so coverage still resolves', async () => {
        await seedAnalysis(REVIEW_A_ID, 1)
        await setSequences({ review: REVIEW_A_ID, sequence: 2 }, 2)

        await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })
        await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({ status: 'stale' })

        await expect(settledCounts()).resolves.toMatchObject({
          headCounter: 1,
          ledgerRows: 1,
        })
        await expect(readWindow()).resolves.toMatchObject({
          coverage: {
            settledAnalysisCount: 1,
            expectedAnalysisCount: 2,
            awaitingAnalysisCount: 1,
          },
        })
      })
    })
  })
})
