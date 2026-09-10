import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPoolStats } from '#/shared/db/pool'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  outboxEvents,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  settleReviewAnalysisWithoutResult,
  type AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createAiReviewEventStoreAdapter } from './adapters/ai-review-event-store.adapter'
import {
  AI_REVIEW_ANALYSIS_CONSUMER,
  handleAiReviewEvent,
  type RegisterAiConsumersInput,
} from './outbox-consumers'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const EVENT_COUNT = 1_000
const SIMULATED_CRASH_AFTER = 137
const ORGANIZATION_ID = organizationId('ai-monotonicity-integration-test')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const REVIEW_IDS = Object.freeze(
  Array.from({ length: EVENT_COUNT }, (_, index) =>
    reviewId(`76100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  ),
)
const EVENT_IDS = Object.freeze(
  Array.from(
    { length: EVENT_COUNT },
    (_, index) => `76200000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ),
)

const db = getDb()
const receipts = createOutboxRepository(db)
const reviewEvents = createAiReviewEventStoreAdapter(db)
const aggregates = createAiPropertyAggregateStoreAdapter(db)

type AnalysisInput = Parameters<RegisterAiConsumersInput['analyzeReviewEvent']>[0]

function eventFor(sequence: number): ConsumerEvent {
  const eventId = EVENT_IDS[sequence - 1]
  const id = REVIEW_IDS[sequence - 1]
  if (!eventId || !id) throw new Error(`No fixture event for sequence ${sequence}`)
  return {
    eventId,
    eventType: 'review.updated',
    eventVersion: 1,
    payload: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: id,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: sequence,
      occurredAt: NOW.toISOString(),
    },
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceContext: 'review',
    sourceAggregateId: id,
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
  }
}

function shuffledSequences(): readonly number[] {
  const values = Array.from({ length: EVENT_COUNT }, (_, index) => index + 1)
  let state = 0x112c0de
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const swapIndex = state % (index + 1)
    const value = values[index]!
    values[index] = values[swapIndex]!
    values[swapIndex] = value
  }
  return values
}

async function settleWithoutProvider(
  input: AnalysisInput,
): Promise<AnalyzeReviewEventResult> {
  const consumed = await reviewEvents.consumeNext({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: 0,
    analysisSequence: input.analysisSequence,
    eventEnvelopeId: input.eventEnvelopeId,
    disposition: input.disposition,
  })
  if (consumed.status === 'generation_changed') return { status: 'generation_changed' }
  const settled = await settleReviewAnalysisWithoutResult(
    { reviewEvents, aggregates },
    {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch: 1,
      analysisSequence: input.analysisSequence,
      propertyProfileVersion: 1,
      operationId: null,
      dispositionCode: 'operation_abandoned',
    },
  )
  if (settled.status === 'generation_changed') return settled
  return consumed.status === 'duplicate' ? { status: 'replayed' } : { status: 'terminal' }
}

const dependencies = {
  analyzeReviewEvent: settleWithoutProvider,
  receipts,
  enqueuePropertyTrend: async () => {},
} satisfies RegisterAiConsumersInput

async function resetSettlementState(): Promise<void> {
  await db.execute(sql`
    DELETE FROM event_consumer_receipts AS receipt
    USING outbox_events AS event
    WHERE receipt.event_id = event.id
      AND event.organization_id = ${ORGANIZATION_ID}
  `)
  await db
    .delete(aiPropertyAggregateContributions)
    .where(eq(aiPropertyAggregateContributions.organizationId, ORGANIZATION_ID))
  await db
    .delete(aiPropertyAggregateSettlements)
    .where(eq(aiPropertyAggregateSettlements.organizationId, ORGANIZATION_ID))
  await db
    .delete(aiPropertyAggregateHeads)
    .where(eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID))
  await db
    .update(reviewAiAnalysisHeads)
    .set({ headSequence: EVENT_COUNT, updatedAt: NOW })
    .where(
      and(
        eq(reviewAiAnalysisHeads.organizationId, ORGANIZATION_ID),
        eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
      ),
    )
}

async function clearFixture(): Promise<void> {
  await db.execute(sql`
    DELETE FROM event_consumer_receipts AS receipt
    USING outbox_events AS event
    WHERE receipt.event_id = event.id
      AND event.organization_id = ${ORGANIZATION_ID}
  `)
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
}

async function settlementState(): Promise<
  Readonly<{
    settlementCount: number
    contributionCount: number
    receiptCount: number
    distinctReceiptCount: number
    aggregateRevision: number
    terminalAnalysisSequence: number
  }>
> {
  const [coverage, contributions, received, head] = await Promise.all([
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM ai_property_aggregate_settlements
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
        AND source_epoch = 0
        AND review_analysis_epoch = 1
    `),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM ai_property_aggregate_contributions
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
    `),
    db.execute<{ count: number; distinct_count: number }>(sql`
      SELECT count(*)::int AS count,
             count(DISTINCT receipt.event_id)::int AS distinct_count
      FROM event_consumer_receipts AS receipt
      WHERE receipt.consumer_name = ${AI_REVIEW_ANALYSIS_CONSUMER}
        AND receipt.event_id IN (
          SELECT event.id
          FROM outbox_events AS event
          WHERE event.organization_id = ${ORGANIZATION_ID}
        )
    `),
    db
      .select({
        aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
        terminalAnalysisSequence: aiPropertyAggregateHeads.terminalAnalysisSequence,
      })
      .from(aiPropertyAggregateHeads)
      .where(
        and(
          eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID),
          eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID),
          eq(aiPropertyAggregateHeads.sourceEpoch, 0),
          eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, 1),
          eq(aiPropertyAggregateHeads.propertyProfileVersion, 1),
        ),
      )
      .limit(1),
  ])
  const aggregate = head[0]
  if (!aggregate) throw new Error('Aggregate head was not created')
  return {
    settlementCount: coverage.rows[0]?.count ?? -1,
    contributionCount: contributions.rows[0]?.count ?? -1,
    receiptCount: received.rows[0]?.count ?? -1,
    distinctReceiptCount: received.rows[0]?.distinct_count ?? -1,
    aggregateRevision: aggregate.aggregateRevision,
    terminalAnalysisSequence: aggregate.terminalAnalysisSequence,
  }
}

async function drainWithProductionConcurrency(
  events: readonly ConsumerEvent[],
): Promise<void> {
  await Promise.all(
    Array.from({ length: 4 }, async (_, workerIndex) => {
      for (let index = workerIndex; index < events.length; index += 4) {
        await handleAiReviewEvent(dependencies, events[index]!)
      }
    }),
  )
}

describe.sequential(
  'Review Analysis per-review monotonic settlement (real PostgreSQL)',
  () => {
    beforeAll(async () => {
      clearEventSchemas()
      registerAllEventSchemas()
      await clearFixture()
      await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (
        ${ORGANIZATION_ID},
        'AI monotonicity integration test',
        ${ORGANIZATION_ID},
        ${NOW}
      )
    `)
      await db.insert(properties).values({
        id: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        name: 'AI monotonicity test property',
        slug: 'ai-monotonicity-test-property',
        timezone: 'America/New_York',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: 0,
      })
      await db.insert(reviews).values(
        REVIEW_IDS.map((id, index) => ({
          id,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          platform: 'google' as const,
          externalId: `ai-monotonicity-review-${index + 1}`,
          reviewerName: `Synthetic reviewer ${index + 1}`,
          rating: 5,
          text: `Synthetic review ${index + 1}`,
          languageCode: 'en',
          reviewedAt: NOW,
          contentExpiresAt: new Date('2027-09-10T12:00:00.000Z'),
          sourceEpoch: 0,
          sourceRevision: 1,
          analysisSequence: index + 1,
          aiSourceByteLength: 20,
          aiSourceDigest: 'a'.repeat(64),
        })),
      )
      await db.insert(reviewAiAnalysisHeads).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        headSequence: EVENT_COUNT,
        createdAt: NOW,
        updatedAt: NOW,
      })
      await db.insert(outboxEvents).values(
        EVENT_IDS.map((id, index) => ({
          id,
          eventType: 'review.updated',
          eventVersion: 1,
          payload: eventFor(index + 1).payload,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          sourceContext: 'review',
          sourceAggregateId: REVIEW_IDS[index]!,
          createdAt: new Date(NOW.getTime() + index),
          publishedAt: NOW,
        })),
      )
    })

    beforeEach(resetSettlementState)

    afterAll(async () => {
      await clearFixture()
      clearEventSchemas()
    })

    it('keeps one coverage ledger across property-profile rollover', async () => {
      await db
        .update(reviewAiAnalysisHeads)
        .set({ headSequence: 3 })
        .where(
          and(
            eq(reviewAiAnalysisHeads.organizationId, ORGANIZATION_ID),
            eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
          ),
        )
      for (const sequence of [2, 1]) {
        await aggregates.advanceWithoutAnalysis({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          reviewId: REVIEW_IDS[sequence - 1]!,
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          analysisSequence: sequence,
          propertyProfileVersion: 1,
          dispositionCode: 'operation_abandoned',
        })
      }
      await expect(
        aggregates.advanceWithoutAnalysis({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          reviewId: REVIEW_IDS[2]!,
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          analysisSequence: 3,
          propertyProfileVersion: 2,
          dispositionCode: 'operation_abandoned',
        }),
      ).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })

      const progress = await db.execute<{ count: number; maximum: number }>(sql`
      SELECT count(*)::int AS count, max(analysis_sequence)::int AS maximum
      FROM ai_property_aggregate_settlements
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
        AND source_epoch = 0
        AND review_analysis_epoch = 1
    `)
      const profileTwo = await db
        .select({ terminal: aiPropertyAggregateHeads.terminalAnalysisSequence })
        .from(aiPropertyAggregateHeads)
        .where(
          and(
            eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID),
            eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID),
            eq(aiPropertyAggregateHeads.propertyProfileVersion, 2),
          ),
        )
      expect(progress.rows).toEqual([{ count: 3, maximum: 3 }])
      expect(profileTwo).toEqual([{ terminal: 3 }])
    })

    it('resumes 1,000 shuffled events after a settlement-to-receipt crash window', async () => {
      const sequences = shuffledSequences()
      const events = sequences.map(eventFor)

      // This is the exact process-death boundary: aggregate transactions have
      // committed, but the consumer has not yet written its durable receipt.
      for (const sequence of sequences.slice(0, SIMULATED_CRASH_AFTER)) {
        await settleReviewAnalysisWithoutResult(
          { reviewEvents, aggregates },
          {
            organizationId: ORGANIZATION_ID,
            propertyId: PROPERTY_ID,
            reviewId: REVIEW_IDS[sequence - 1]!,
            sourceEpoch: 0,
            reviewAnalysisEpoch: 1,
            analysisSequence: sequence,
            propertyProfileVersion: 1,
            operationId: null,
            dispositionCode: 'operation_abandoned',
          },
        )
      }
      await expect(settlementState()).resolves.toMatchObject({
        settlementCount: SIMULATED_CRASH_AFTER,
        contributionCount: 0,
        receiptCount: 0,
        aggregateRevision: SIMULATED_CRASH_AFTER,
      })

      const startedAt = performance.now()
      await drainWithProductionConcurrency(events)
      const elapsedMillis = performance.now() - startedAt
      process.stdout.write(
        `[review-analysis-monotonic-drain] events=${EVENT_COUNT} concurrency=4 elapsed_ms=${elapsedMillis.toFixed(1)}\n`,
      )

      await expect(settlementState()).resolves.toEqual({
        settlementCount: EVENT_COUNT,
        contributionCount: 0,
        receiptCount: EVENT_COUNT,
        distinctReceiptCount: EVENT_COUNT,
        aggregateRevision: EVENT_COUNT,
        terminalAnalysisSequence: EVENT_COUNT,
      })
      const pool = getPoolStats()
      expect(pool).not.toBeNull()
      expect(pool?.waitingCount).toBe(0)
      expect(pool?.totalCount).toBeLessThanOrEqual(pool?.max ?? 0)
    }, 120_000)
  },
)
