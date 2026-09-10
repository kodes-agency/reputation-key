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
import type { Job, JobsOptions } from 'bullmq'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateHeads,
  aiReviewAnalysisEnrollments,
  eventConsumerReceipts,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createConsumerRegistry,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  createPublishedEventRedeliveryHandler,
  type PublishedEventRedeliveryQueue,
} from '#/shared/outbox/published-event-redelivery.job'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  settleReviewAnalysisWithoutResult,
  type AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createAiReviewEventStoreAdapter } from './adapters/ai-review-event-store.adapter'
import {
  createReviewAnalysisBackfillChainAdapter,
  type ReviewAnalysisBackfillChainQueue,
} from './adapters/ai-review-analysis-backfill-chain.adapter'
import {
  AI_REVIEW_ANALYSIS_CONSUMER,
  handleAiReviewEvent,
  registerAiConsumers,
  type RegisterAiConsumersInput,
} from './outbox-consumers'

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => loggerMocks,
}))

const NOW = new Date('2026-09-10T12:00:00.000Z')
const TWO_HOURS = 2 * 60 * 60 * 1_000
const ORGANIZATION_ID = organizationId('ai-backfill-chain-integration-test')
const PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000002')
const CORRELATION_ID = '75000000-0000-4000-8000-000000000003'
const AUTHORIZATION_LINEAGE_ID = '75000000-0000-4000-8000-000000000004'
const TRIGGER_EVENT_ID = '75000000-0000-4000-8000-000000000005'
const EVENT_IDS = Object.freeze(
  Array.from(
    { length: 6 },
    (_, index) => `75000000-0000-4000-8000-${String(index + 6).padStart(12, '0')}`,
  ),
)

const db = getDb()
const receipts = createOutboxRepository(db)
const reviewEvents = createAiReviewEventStoreAdapter(db)
const aggregates = createAiPropertyAggregateStoreAdapter(db)

type QueuedEvent = Readonly<{
  name: string
  data: unknown
  options: JobsOptions
}>

function eventFor(sequence: number): ConsumerEvent {
  const eventId = EVENT_IDS[sequence - 1]
  if (!eventId) throw new Error(`No fixture event for sequence ${sequence}`)
  return {
    eventId,
    eventType: 'ai.review_analysis.backfill_requested',
    eventVersion: 1,
    payload: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: `75000000-0000-4000-8000-${String(sequence + 100).padStart(12, '0')}`,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: sequence,
      occurredAt: NOW.toISOString(),
      correlationId: CORRELATION_ID,
    },
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceContext: 'ai',
    sourceAggregateId: PROPERTY_ID,
    correlationId: CORRELATION_ID,
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
  }
}

async function analyzeInStrictOrder(
  input: Parameters<RegisterAiConsumersInput['analyzeReviewEvent']>[0],
): Promise<AnalyzeReviewEventResult> {
  const consumed = await reviewEvents.consumeNext({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: 0,
    analysisSequence: input.analysisSequence,
    eventEnvelopeId: input.eventEnvelopeId,
    disposition: input.disposition,
  })
  if (consumed.status === 'gap') {
    return { status: 'gap', expectedSequence: consumed.expectedSequence }
  }
  if (consumed.status === 'generation_changed') return { status: 'generation_changed' }
  return settleReviewAnalysisWithoutResult(
    { reviewEvents, aggregates },
    {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch: 1,
      analysisSequence: input.analysisSequence,
      propertyProfileVersion: 1,
      operationId: null,
      dispositionCode: 'operation_abandoned',
    },
  )
}

function recordingQueue(target: QueuedEvent[]): ReviewAnalysisBackfillChainQueue {
  return {
    add: async (name, data, options) => {
      target.push({ name, data, options })
    },
  }
}

function dependenciesFor(queue: ReviewAnalysisBackfillChainQueue) {
  const analyzeReviewEvent = vi.fn(analyzeInStrictOrder)
  const chainWarn = vi.fn()
  const advanceReviewAnalysisBackfill = createReviewAnalysisBackfillChainAdapter({
    db,
    queue,
    logger: { warn: chainWarn },
  })
  return {
    dependencies: {
      analyzeReviewEvent,
      advanceReviewAnalysisBackfill,
      receipts,
      enqueuePropertyTrend: async () => {},
    },
    analyzeReviewEvent,
    chainWarn,
  }
}

function fakeJob(queued: Pick<QueuedEvent, 'name' | 'data'>, id: string): Job {
  return { id, name: queued.name, data: queued.data } as unknown as Job
}

async function drainChain(
  dependencies: RegisterAiConsumersInput,
  queued: QueuedEvent[],
): Promise<void> {
  while (queued.length > 0) {
    const next = queued.shift()
    if (!next) throw new Error('Queued chain event disappeared')
    await handleAiReviewEvent(dependencies, next.data as ConsumerEvent)
  }
}

async function frontierAndReceipts(): Promise<{
  frontier: number
  receipts: number
  missingReceipts: number
}> {
  const [head] = await db
    .select({ frontier: aiPropertyAggregateHeads.terminalAnalysisSequence })
    .from(aiPropertyAggregateHeads)
    .where(
      and(
        eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID),
        eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID),
        eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, 1),
      ),
    )
  const received = await db
    .select({ eventId: eventConsumerReceipts.eventId })
    .from(eventConsumerReceipts)
    .where(
      and(
        eq(eventConsumerReceipts.consumerName, AI_REVIEW_ANALYSIS_CONSUMER),
        inArray(eventConsumerReceipts.eventId, EVENT_IDS),
      ),
    )
  return {
    frontier: head?.frontier ?? -1,
    receipts: received.length,
    missingReceipts: EVENT_IDS.length - received.length,
  }
}

async function resetFixture(): Promise<void> {
  await db
    .delete(eventConsumerReceipts)
    .where(inArray(eventConsumerReceipts.eventId, EVENT_IDS))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  await db
    .delete(aiReviewAnalysisEnrollments)
    .where(eq(aiReviewAnalysisEnrollments.id, CORRELATION_ID))
  await db
    .delete(aiPropertyAggregateHeads)
    .where(
      and(
        eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID),
        eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID),
      ),
    )
  await db.insert(aiReviewAnalysisEnrollments).values({
    id: CORRELATION_ID,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    authorizationLineageId: AUTHORIZATION_LINEAGE_ID,
    authorizationStateVersion: 1,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: 0,
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    triggerEventEnvelopeId: TRIGGER_EVENT_ID,
    state: 'running',
    snapshotRevisionCount: EVENT_IDS.length,
    snapshotRevisionSetDigest: 'f'.repeat(64),
    snapshotCapturedAt: NOW,
    enrolledRevisionCount: EVENT_IDS.length,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(aiPropertyAggregateHeads).values({
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    propertyProfileVersion: 1,
    aggregateRevision: 0,
    terminalAnalysisSequence: 0,
    updatedAt: NOW,
  })
  await db.insert(outboxEvents).values(
    EVENT_IDS.map((id, index) => ({
      id,
      eventType: 'ai.review_analysis.backfill_requested',
      eventVersion: 1,
      payload: eventFor(index + 1).payload,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceContext: 'ai',
      sourceAggregateId: PROPERTY_ID,
      createdAt: new Date(NOW.getTime() + index),
      publishedAt: NOW,
    })),
  )
}

async function clearFixture(): Promise<void> {
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
}

describe('Review Analysis backfill chain (real PostgreSQL)', () => {
  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearFixture()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (
        ${ORGANIZATION_ID},
        'AI backfill chain integration test',
        ${ORGANIZATION_ID},
        ${NOW}
      )
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI backfill chain test property',
      slug: 'ai-backfill-chain-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      headSequence: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: AUTHORIZATION_LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: 'ai-backfill-chain-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-backfill-chain-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: AUTHORIZATION_LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: 'ai-backfill-chain-test-actor',
        updatedAt: NOW,
      })
    })
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    resetDelayedExecutionPolicy()
    initDelayedExecutionPolicy({
      decide: async (request) => ({
        outcome: 'allow',
        allowed: true,
        reason: 'allowed',
        action: request.action,
        policyVersion: 'ai-backfill-chain-integration-v1',
        freshRead: true,
      }),
    })
    await resetFixture()
  })

  afterEach(() => {
    resetDelayedExecutionPolicy()
  })

  afterAll(async () => {
    await clearFixture()
    clearEventSchemas()
  })

  it('drains six initially out-of-order events through one successor per settlement', async () => {
    const queued: QueuedEvent[] = []
    const test = dependenciesFor(recordingQueue(queued))

    for (const sequence of [6, 5, 4, 3, 2]) {
      await expect(
        handleAiReviewEvent(test.dependencies, eventFor(sequence)),
      ).rejects.toThrow('AI review analysis sequence gap')
    }
    await expect(handleAiReviewEvent(test.dependencies, eventFor(1))).resolves.toEqual({
      status: 'applied',
    })

    expect(queued).toHaveLength(1)
    expect(queued[0]?.options.jobId).toBe(`${EVENT_IDS[1]}-chain-after-${EVENT_IDS[0]}`)
    await drainChain(test.dependencies, queued)

    expect(test.analyzeReviewEvent).toHaveBeenCalledTimes(11)
    expect(await frontierAndReceipts()).toEqual({
      frontier: 6,
      receipts: 6,
      missingReceipts: 0,
    })
    expect(queued).toEqual([])
  })

  it('keeps an out-of-order attempt visible as a gap without applying it', async () => {
    const queued: QueuedEvent[] = []
    const test = dependenciesFor(recordingQueue(queued))
    await expect(
      aggregates.advanceWithoutAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        analysisSequence: 2,
        propertyProfileVersion: 1,
        dispositionCode: 'operation_abandoned',
      }),
    ).resolves.toEqual({ status: 'gap', expectedAnalysisSequence: 1 })

    await expect(handleAiReviewEvent(test.dependencies, eventFor(2))).rejects.toThrow(
      'AI review analysis sequence gap',
    )

    expect(await frontierAndReceipts()).toEqual({
      frontier: 0,
      receipts: 0,
      missingReceipts: 6,
    })
    expect(queued).toEqual([])
  })

  it('refuses a wake before settlement and receipt, across properties, or across enrollment epochs', async () => {
    const queued: QueuedEvent[] = []
    const chainWarn = vi.fn()
    const advance = createReviewAnalysisBackfillChainAdapter({
      db,
      queue: recordingQueue(queued),
      logger: { warn: chainWarn },
    })
    const command = {
      eventId: EVENT_IDS[0]!,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      correlationId: CORRELATION_ID,
      analysisSequence: 1,
    }

    await expect(advance(command)).resolves.toEqual({
      status: 'stopped',
      reason: 'no_successor',
    })
    await db
      .update(aiPropertyAggregateHeads)
      .set({ aggregateRevision: 1, terminalAnalysisSequence: 1 })
      .where(
        and(
          eq(aiPropertyAggregateHeads.organizationId, ORGANIZATION_ID),
          eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID),
        ),
      )
    await expect(advance(command)).resolves.toEqual({
      status: 'stopped',
      reason: 'no_successor',
    })
    await receipts.insertReceipt(EVENT_IDS[0]!, AI_REVIEW_ANALYSIS_CONSUMER, 'applied')
    await expect(advance({ ...command, propertyId: OTHER_PROPERTY_ID })).resolves.toEqual(
      { status: 'stopped', reason: 'no_successor' },
    )
    await db
      .update(aiReviewAnalysisEnrollments)
      .set({ reviewAnalysisEpoch: 2 })
      .where(eq(aiReviewAnalysisEnrollments.id, CORRELATION_ID))
    await expect(advance(command)).resolves.toEqual({
      status: 'stopped',
      reason: 'no_successor',
    })

    expect(queued).toEqual([])
    expect(chainWarn).not.toHaveBeenCalled()
  })

  it('recovers a dropped wake through published redelivery and no-ops stale jobs', async () => {
    const chainJobs: QueuedEvent[] = []
    let dropNextWake = true
    const chainQueue: ReviewAnalysisBackfillChainQueue = {
      add: async (name, data, options) => {
        if (dropNextWake) {
          dropNextWake = false
          throw new Error(`redis lost ${EVENT_IDS[1]}`)
        }
        chainJobs.push({ name, data, options })
      },
    }
    const test = dependenciesFor(chainQueue)

    await expect(handleAiReviewEvent(test.dependencies, eventFor(1))).resolves.toEqual({
      status: 'applied',
    })
    expect(await frontierAndReceipts()).toEqual({
      frontier: 1,
      receipts: 1,
      missingReceipts: 5,
    })
    expect(test.chainWarn).toHaveBeenCalledWith(
      {
        eventType: 'ai.review_analysis.backfill_requested',
        reason: 'enqueue_failed',
      },
      'Review Analysis backfill successor wake deferred to durable redelivery',
    )
    expect(Object.keys(test.chainWarn.mock.calls[0]![0] as object).sort()).toEqual([
      'eventType',
      'reason',
    ])

    const redeliveryJobs: QueuedEvent[] = []
    const redeliveryQueue: PublishedEventRedeliveryQueue = {
      add: async (name, data, options) => {
        redeliveryJobs.push({ name, data, options })
      },
    }
    const redeliver = createPublishedEventRedeliveryHandler({
      repo: receipts,
      queue: redeliveryQueue,
      clock: () => new Date(NOW.getTime() + TWO_HOURS + 1),
      logger: loggerMocks,
      consumerExpectations: [
        {
          eventType: 'ai.review_analysis.backfill_requested',
          consumerName: AI_REVIEW_ANALYSIS_CONSUMER,
        },
      ],
    })
    await redeliver({} as Job)
    expect(redeliveryJobs).toHaveLength(5)

    const headRedelivery = redeliveryJobs.shift()
    if (!headRedelivery) throw new Error('Redelivery did not enqueue sequence 2')
    await handleAiReviewEvent(test.dependencies, headRedelivery.data as ConsumerEvent)
    await drainChain(test.dependencies, chainJobs)
    expect(await frontierAndReceipts()).toEqual({
      frontier: 6,
      receipts: 6,
      missingReceipts: 0,
    })

    const registry = createConsumerRegistry()
    registerAiConsumers(registry, test.dependencies)
    const dispatch = createDispatcherHandler(receipts, { consumers: registry })
    const analysisCallsBeforeStaleJobs = test.analyzeReviewEvent.mock.calls.length
    const failureLogsBeforeStaleJobs = loggerMocks.error.mock.calls.length
    for (const [index, stale] of redeliveryJobs.entries()) {
      await expect(
        dispatch(fakeJob(stale, `stale-redelivery-${index}`)),
      ).resolves.toBeUndefined()
    }
    await expect(
      dispatch(
        fakeJob(
          {
            name: eventFor(2).eventType,
            data: eventFor(2),
          },
          EVENT_IDS[1]!,
        ),
      ),
    ).resolves.toBeUndefined()

    expect(test.analyzeReviewEvent).toHaveBeenCalledTimes(analysisCallsBeforeStaleJobs)
    expect(loggerMocks.error).toHaveBeenCalledTimes(failureLogsBeforeStaleJobs)
    expect(await frontierAndReceipts()).toEqual({
      frontier: 6,
      receipts: 6,
      missingReceipts: 0,
    })
  })
})
