import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiOperations,
  aiPropertyAggregateSettlements,
  eventConsumerReceipts,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  COMPLETED_AT,
  CONTENT_EXPIRES_AT,
  NOW,
  OPERATION_EXPIRES_AT,
  OPERATION_ID,
  ORGANIZATION_ID,
  ORIGIN_EVENT_ID,
  PROPERTY_ID,
  REVIEWED_AT,
  REVIEW_A_SOURCE_DIGEST,
  SOURCE_BYTE_COUNT,
  SOURCE_EPOCH,
  SOURCE_REVISION,
  createReviewAnalysisStoreFixture,
} from './review-analysis-store.test-fixtures'
import type { AiOperationId } from '../domain/types'
import { createAiOperationStoreAdapter } from '../execution/ai-operation-store.adapter.server'
import { createAiOperationExecutionReaper } from './ai-operation-execution-reaper.server'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter.server'
import { createAiReviewAnalysisReceiptWriter } from './ai-review-analysis-receipt.adapter.server'
import { AI_REVIEW_ANALYSIS_CONSUMER } from './outbox-consumers.server'
import { seedReviewContent } from './review-content.test-fixtures'

const EXECUTION_HORIZON_MILLIS = 15 * 60_000

/** What one reaper pass reports when nothing happened; a case names what did. */
const reaperTotals = (counts: Readonly<Record<string, number>>) => ({
  recoveryCandidatesVisited: 0,
  operationsFenced: 0,
  operationsDelivered: 0,
  operationsSettled: 0,
  operationsRaced: 0,
  candidatesFailed: 0,
  batchFull: false,
  ...counts,
})

describe.sequential('AI output store analysis persistence (real PostgreSQL)', () => {
  const db = getDb()
  const fixture = createReviewAnalysisStoreFixture(db)
  const { seedOriginEvent, failOperation, seedStoredReviewA } = fixture
  const operations = createAiOperationStoreAdapter(db, () => {
    throw new Error('Recovery does not create operation ids')
  })

  beforeAll(fixture.install)
  beforeEach(fixture.resetBetweenTests)
  afterEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  })
  afterAll(fixture.remove)

  it('exposes every unreceipted terminal analysis failure to the reaper', async () => {
    await seedOriginEvent(ORIGIN_EVENT_ID)
    await failOperation(OPERATION_ID)

    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: COMPLETED_AT.getTime(),
        executionHorizonMillis: EXECUTION_HORIZON_MILLIS,
        limit: 10,
      }),
    ).resolves.toEqual({
      candidates: [
        expect.objectContaining({
          operationId: OPERATION_ID,
          state: 'failed',
          failureCode: 'output_invalid',
          analysis: expect.objectContaining({
            eventEnvelopeId: ORIGIN_EVENT_ID,
            analysisSequence: 1,
          }),
        }),
      ],
      unreadable: [],
    })
  })

  describe('a tenant whose recovery sorts behind another tenant’s unrecoverable row', () => {
    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    const writeReceipt = createAiReviewAnalysisReceiptWriter(db)
    // Sorts after ORGANIZATION_ID, so the reaper reaches it second.
    const SECOND_ORGANIZATION_ID = organizationId('ai-output-store-test-org-z')
    const SECOND_PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000021')
    const SECOND_REVIEW_ID = reviewId('75000000-0000-4000-8000-000000000022')
    const SECOND_OPERATION_ID = '75000000-0000-4000-8000-000000000023' as AiOperationId
    const SECOND_EVENT_ID = '75000000-0000-4000-8000-000000000024'
    const RECOVERED_AT_MILLIS = NOW.getTime() + 60 * 60_000
    const SECOND_TENANT_ORIGIN = {
      organizationId: SECOND_ORGANIZATION_ID,
      propertyId: SECOND_PROPERTY_ID,
      reviewId: SECOND_REVIEW_ID,
    }
    const SECOND_TENANT_RECOVERED = {
      operation: { state: 'failed', failureCode: 'operation_ambiguous' },
      receipted: true,
      ledgerRows: 1,
    }
    /** The retention sweep's statement: the event goes, and its receipts with it. */
    const retireOriginEvent = (eventId: string) =>
      db.delete(outboxEvents).where(eq(outboxEvents.id, eventId))

    const reapAt = (
      recordAnalysisReceipt: (
        eventId: string,
        status: 'applied' | 'obsolete',
      ) => Promise<void>,
      warn = vi.fn(),
    ) =>
      createAiOperationExecutionReaper({
        store: operations,
        aggregates,
        recordAnalysisReceipt,
        logger: { warn },
        nowEpochMillis: () => RECOVERED_AT_MILLIS,
      })()

    const secondTenantOutcome = async () => {
      const [operation] = await db
        .select({ state: aiOperations.state, failureCode: aiOperations.failureCode })
        .from(aiOperations)
        .where(eq(aiOperations.id, SECOND_OPERATION_ID))
      return {
        operation,
        receipted: await outboxRepo.hasReceipt(
          SECOND_EVENT_ID,
          AI_REVIEW_ANALYSIS_CONSUMER,
        ),
        ledgerRows: (
          await db
            .select({ sequence: aiPropertyAggregateSettlements.analysisSequence })
            .from(aiPropertyAggregateSettlements)
            .where(eq(aiPropertyAggregateSettlements.propertyId, SECOND_PROPERTY_ID))
        ).length,
      }
    }
    const outboxRepo = createOutboxRepository(db)

    beforeEach(async () => {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${SECOND_ORGANIZATION_ID}, 'AI output store second tenant', ${SECOND_ORGANIZATION_ID}, ${NOW})
      `)
      await db.insert(properties).values({
        id: SECOND_PROPERTY_ID,
        organizationId: SECOND_ORGANIZATION_ID,
        name: 'AI output store second tenant property',
        slug: 'ai-output-store-second-tenant-property',
        timezone: 'America/New_York',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: SOURCE_EPOCH,
      })
      await seedReviewContent({
        id: SECOND_REVIEW_ID,
        organizationId: SECOND_ORGANIZATION_ID,
        propertyId: SECOND_PROPERTY_ID,
        platform: 'google',
        externalId: 'ai-output-store-review-second-tenant',
        reviewerName: 'Synthetic reviewer Z',
        rating: 5,
        text: 'Synthetic review Z',
        languageCode: 'en',
        reviewedAt: REVIEWED_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        aiSourceByteLength: SOURCE_BYTE_COUNT,
        aiSourceDigest: REVIEW_A_SOURCE_DIGEST,
      })
      // The second tenant's attempt lost its owner mid-flight.
      await fixture.cloneOperation({
        id: SECOND_OPERATION_ID,
        organizationId: SECOND_ORGANIZATION_ID,
        propertyId: SECOND_PROPERTY_ID,
        reviewId: SECOND_REVIEW_ID,
        originEventId: SECOND_EVENT_ID,
        analysisSequence: 1,
        state: 'executing',
        failureCode: null,
        updatedAt: NOW,
      })
      await seedOriginEvent(SECOND_EVENT_ID, SECOND_TENANT_ORIGIN)
    })

    afterEach(async () => {
      await db
        .delete(aiOperations)
        .where(eq(aiOperations.organizationId, SECOND_ORGANIZATION_ID))
      await db
        .delete(outboxEvents)
        .where(eq(outboxEvents.organizationId, SECOND_ORGANIZATION_ID))
      await db.delete(properties).where(eq(properties.id, SECOND_PROPERTY_ID))
      await deleteTestOrganizations(db, [SECOND_ORGANIZATION_ID])
    })

    it('is not offered a failed analysis whose origin event the outbox retention has deleted', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)
      await failOperation(OPERATION_ID)
      await retireOriginEvent(ORIGIN_EVENT_ID)

      await expect(
        operations.listExpiredExecutions({
          nowEpochMillis: COMPLETED_AT.getTime(),
          executionHorizonMillis: EXECUTION_HORIZON_MILLIS,
          limit: 10,
        }),
      ).resolves.toEqual({ candidates: [], unreadable: [] })
    })

    it('is fenced and receipted although the first tenant has a failed analysis whose event was deleted', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)
      await failOperation(OPERATION_ID)
      await retireOriginEvent(ORIGIN_EVENT_ID)
      // The pre-fix reaper wrote its receipts with the shared repository, whose
      // insert breaks the event foreign key for the first tenant's row.
      const reaped = await reapAt((eventId, status) =>
        outboxRepo.insertReceipt(eventId, AI_REVIEW_ANALYSIS_CONSUMER, status),
      )

      expect(reaped).toEqual(
        reaperTotals({
          recoveryCandidatesVisited: 1,
          operationsFenced: 1,
          operationsSettled: 1,
        }),
      )
      await expect(secondTenantOutcome()).resolves.toEqual(SECOND_TENANT_RECOVERED)
    })

    it('is recovered although the first tenant’s receipt cannot be written, and the failure is reported', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)
      await failOperation(OPERATION_ID)
      const receiptFailure = new Error('receipt store unavailable')
      const warn = vi.fn()

      const reaped = await reapAt(
        async (eventId, status) =>
          eventId === ORIGIN_EVENT_ID
            ? Promise.reject(receiptFailure)
            : writeReceipt(eventId, status),
        warn,
      )

      expect(reaped).toEqual(
        reaperTotals({
          recoveryCandidatesVisited: 2,
          operationsFenced: 1,
          operationsSettled: 1,
          candidatesFailed: 1,
        }),
      )
      await expect(secondTenantOutcome()).resolves.toEqual(SECOND_TENANT_RECOVERED)
      await expect(
        outboxRepo.hasReceipt(ORIGIN_EVENT_ID, AI_REVIEW_ANALYSIS_CONSUMER),
      ).resolves.toBe(false)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(
        {
          err: receiptFailure,
          operationId: OPERATION_ID,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          state: 'failed',
        },
        'AI operation recovery candidate failed',
      )
    })

    it('is recovered although the first tenant’s operation row cannot be read, and the row is reported', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)
      // A stored fence that no release accepts any longer.
      await db
        .update(aiOperations)
        .set({ capabilityFences: { capability: 'not_a_capability' } })
        .where(eq(aiOperations.id, OPERATION_ID))
      const warn = vi.fn()

      try {
        await expect(
          operations.listExpiredExecutions({
            nowEpochMillis: RECOVERED_AT_MILLIS,
            executionHorizonMillis: EXECUTION_HORIZON_MILLIS,
            limit: 10,
          }),
        ).resolves.toEqual({
          candidates: [expect.objectContaining({ operationId: SECOND_OPERATION_ID })],
          unreadable: [{ operationId: OPERATION_ID, organizationId: ORGANIZATION_ID }],
        })

        const reaped = await reapAt(writeReceipt, warn)

        expect(reaped).toEqual(
          reaperTotals({
            recoveryCandidatesVisited: 2,
            operationsFenced: 1,
            operationsSettled: 1,
            candidatesFailed: 1,
          }),
        )
        await expect(secondTenantOutcome()).resolves.toEqual(SECOND_TENANT_RECOVERED)
        expect(warn).toHaveBeenCalledWith(
          { operationId: OPERATION_ID, organizationId: ORGANIZATION_ID },
          'AI operation recovery row unreadable',
        )
      } finally {
        await db
          .update(aiOperations)
          .set({
            capabilityFences: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
          })
          .where(eq(aiOperations.id, OPERATION_ID))
      }
    })
  })

  describe('the reaper recording a receipt', () => {
    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    const writeReceipt = createAiReviewAnalysisReceiptWriter(db)

    const receiptStatuses = async (eventId: string) =>
      (
        await db
          .select({ status: eventConsumerReceipts.status })
          .from(eventConsumerReceipts)
          .where(eq(eventConsumerReceipts.eventId, eventId))
      ).map((row) => row.status)

    it('writes it while the event is in the outbox and keeps the first status', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)

      await writeReceipt(ORIGIN_EVENT_ID, 'applied')
      await writeReceipt(ORIGIN_EVENT_ID, 'obsolete')

      await expect(receiptStatuses(ORIGIN_EVENT_ID)).resolves.toEqual(['applied'])
    })

    it('writes nothing, and does not fail, once retention has deleted the event', async () => {
      await seedOriginEvent(ORIGIN_EVENT_ID)
      await db.delete(outboxEvents).where(eq(outboxEvents.id, ORIGIN_EVENT_ID))

      await expect(writeReceipt(ORIGIN_EVENT_ID, 'applied')).resolves.toBeUndefined()

      await expect(receiptStatuses(ORIGIN_EVENT_ID)).resolves.toEqual([])
    })

    it('still delivers a stored analysis whose event was retired before the reaper reached it', async () => {
      await seedStoredReviewA()
      await seedOriginEvent(ORIGIN_EVENT_ID)
      await db.delete(outboxEvents).where(eq(outboxEvents.id, ORIGIN_EVENT_ID))
      const reaper = createAiOperationExecutionReaper({
        store: operations,
        aggregates,
        recordAnalysisReceipt: writeReceipt,
        nowEpochMillis: () => COMPLETED_AT.getTime() + 60 * 60_000,
      })

      await expect(reaper()).resolves.toEqual(
        reaperTotals({ recoveryCandidatesVisited: 1, operationsDelivered: 1 }),
      )

      const [delivered] = await db
        .select({ state: aiOperations.state })
        .from(aiOperations)
        .where(eq(aiOperations.id, OPERATION_ID))
      expect(delivered).toEqual({ state: 'succeeded' })
    })
  })

  it('abandons a pending analysis at its own horizon, not the execution horizon', async () => {
    // A backfill operation waiting on a rate-limited provider: created at NOW,
    // open for a day. Fifteen minutes of age is not abandonment.
    await db
      .update(aiOperations)
      .set({
        state: 'pending',
        failureCode: 'provider_rate_limited',
        nextAttemptAt: new Date(NOW.getTime() + 20 * 60_000),
        updatedAt: NOW,
      })
      .where(eq(aiOperations.id, OPERATION_ID))

    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: NOW.getTime() + EXECUTION_HORIZON_MILLIS + 1,
        executionHorizonMillis: EXECUTION_HORIZON_MILLIS,
        limit: 10,
      }),
    ).resolves.toEqual({ candidates: [], unreadable: [] })
    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: OPERATION_EXPIRES_AT.getTime(),
        executionHorizonMillis: EXECUTION_HORIZON_MILLIS,
        limit: 10,
      }),
    ).resolves.toEqual({
      candidates: [
        expect.objectContaining({ operationId: OPERATION_ID, state: 'pending' }),
      ],
      unreadable: [],
    })
  })
})
