import { seedReviewContent } from '../analysis/review-content.test-fixtures'
// Reviews settled without an analysis remain eligible for the reopen queue.
// An enrollment cannot catch up while any of its reviews still waits for one.
// These suites prove that recovery against PostgreSQL, including its limits.

import { resolveReviewPropertyContext } from '#/shared/analysis/review-vocabulary-hints'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/analysis/normalizer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  aiOperations,
  aiPropertyAggregateSettlements,
  aiReviewAnalyses,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { readCurrentStopFence } from '#/shared/db/testing/ai-execution-control-fixture'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import {
  insertAnalysisOperation,
  seedAnalysisProperty,
} from '#/shared/db/testing/review-analysis-store-fixture'
import {
  analysisExecutionBinding,
  analysisOperationIdentity,
} from '../execution/ai-operation-binding.server'
import { aiRequestFingerprint } from '../application/ai-workflow-support'
import { resolveAnalysisClaimConflict } from '../analysis/analysis-claim-conflict.server'
import { AI_REVIEW_ANALYSIS_MAX_REOPENS } from '../domain/review-analysis-reopen'
import type { AiExecutionStopFence } from '../domain/types'
import { createAiOperationStoreAdapter } from '../execution/ai-operation-store.adapter.server'
import {
  createAiReviewAnalysisReopenAdapter,
  listSpentReviewAnalyses,
  reopenSpentReviewAnalyses,
} from './reopen-store.server'
import { createReviewAnalysisEnrollmentAdapter } from './enrollment-store.server'

const NOW = new Date('2026-09-29T17:37:00.000Z')
const LATER = new Date('2026-09-29T17:45:00.000Z')
const BACKFILL = 'ai.review_analysis.backfill_requested'

type Scope = Readonly<{ organizationId: string; propertyId: string; lineageId: string }>
type OperationIds = Readonly<{ operationId: string; eventId: string }>

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

async function clearScope(scope: Scope) {
  const db = getDb()
  await db.execute(sql`
    DELETE FROM event_consumer_receipts
    WHERE event_id IN (
      SELECT id FROM outbox_events WHERE organization_id = ${scope.organizationId}
    )
  `)
  await db
    .delete(outboxEvents)
    .where(eq(outboxEvents.organizationId, scope.organizationId))
  await db.delete(properties).where(eq(properties.id, scope.propertyId))
  await deleteTestOrganizations(db, [scope.organizationId])
}

async function seedEnabledProperty(scope: Scope) {
  const db = getDb()
  await seedAnalysisProperty(db, {
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    name: 'AI reopen test',
    slug: `ai-reopen-${scope.propertyId.slice(0, 8)}`,
    timezone: 'Europe/Sofia',
    countryCode: 'BG',
    sourceEpoch: 0,
    headSequence: 0,
    now: NOW,
  })
  await seedEnabledReviewAnalysis(db, {
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    authorizationLineageId: scope.lineageId,
    analysisStartSequence: 0,
    authorizedSourceEpoch: 0,
    replyDrafting: true,
    propertyTrends: true,
    occurredAt: NOW,
    actorUserId: 'ai-reopen-test-actor',
    reasonCode: 'merchant_enabled',
    idempotencyKey: `ai-reopen-enable-${scope.propertyId}`,
    requestHash: 'c'.repeat(64),
  })
}

/** The merchant keeps Reply Drafting and switches Review Analysis off. */
async function switchReviewAnalysisOff(scope: Scope) {
  const db = getDb()
  const authorization = {
    ...authorizationHead(scope),
    capabilities: ['reply_drafting'],
    capabilityRuntimeProfileVersions: { reply_drafting: 'reply-drafting-runtime-v1' },
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...authorization,
      stateVersion: 2,
      transitionKind: 'change',
      actorUserId: 'ai-reopen-test-actor',
      reasonCode: 'merchant_changed',
      idempotencyKey: `ai-reopen-change-${scope.propertyId}`,
      requestHash: 'd'.repeat(64),
      occurredAt: LATER,
    })
    await tx
      .update(merchantAiEnablement)
      .set({ ...authorization, stateVersion: 2, updatedAt: LATER })
      .where(eq(merchantAiEnablement.propertyId, scope.propertyId))
  })
}

function authorizationHead(scope: Scope) {
  return {
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    authorizationLineageId: scope.lineageId,
    state: 'enabled',
    capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
    capabilityRuntimeProfileVersions: {
      review_analysis: 'review-analysis-runtime-v1',
      reply_drafting: 'reply-drafting-runtime-v1',
      property_trends: 'property-trends-runtime-v1',
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
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    redactionProfileFamily: 'gbp-review-global-v1',
  }
}

function reviewFixture(scope: Scope) {
  const db = getDb()
  return {
    async review(input: { id: string; analysisSequence: number; text?: string | null }) {
      await seedReviewContent({
        id: input.id,
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        platform: 'google',
        externalId: `ai-reopen-${input.id}`,
        reviewerName: 'Synthetic reviewer',
        rating: 4,
        text: input.text === undefined ? 'Synthetic review content' : input.text,
        languageCode: 'en',
        reviewedAt: NOW,
        contentExpiresAt: new Date('2027-09-29T00:00:00.000Z'),
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: input.analysisSequence,
        aiSourceByteLength: 24,
        aiSourceDigest: 'a'.repeat(64),
      })
      await db.insert(materialReviewRevisions).values({
        reviewId: input.id,
        revision: 1,
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        sourceEpoch: 0,
        normalizationVersion: 'legacy-unverified-v0',
        rating: 4,
        normalizedText: 'Synthetic review content',
      })
    },

    async operation(input: {
      id: string
      reviewId: string
      analysisSequence: number
      originEventId: string
      state: 'failed' | 'succeeded' | 'pending'
      failureCode?: string | null
    }) {
      await insertAnalysisOperation(db, {
        id: input.id,
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        reviewId: input.reviewId,
        authorizationLineageId: scope.lineageId,
        analysisSequence: input.analysisSequence,
        sourceEpoch: 0,
        sourceRevision: 1,
        profile: 'review-analysis-v2',
        state: input.state,
        idempotencyKey: `analysis:${input.originEventId}`,
        originEventId: input.originEventId,
        requestFingerprint: 'b'.repeat(64),
        sourceDigest: 'c'.repeat(64),
        subjectHmacKeyVersion: 'ai-reopen-test-v1',
        reviewedAt: NOW,
        now: NOW,
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
        executionAttempt: 4,
        failureCode: input.failureCode,
      })
    },

    /** An operation that gave up with this failure code, settled in the aggregate ledger. */
    async abandon(
      review: string,
      sequence: number,
      failureCode: string,
      ids: OperationIds,
    ) {
      await this.operation({
        id: ids.operationId,
        reviewId: review,
        analysisSequence: sequence,
        originEventId: ids.eventId,
        state: 'failed',
        failureCode,
      })
      await this.settle(review, sequence)
    },

    /** A succeeded operation with its ready analysis, settled in the aggregate ledger. */
    async analysed(review: string, sequence: number, ids: OperationIds) {
      await this.operation({
        id: ids.operationId,
        reviewId: review,
        analysisSequence: sequence,
        originEventId: ids.eventId,
        state: 'succeeded',
      })
      await this.readyAnalysis({
        reviewId: review,
        analysisSequence: sequence,
        operationId: ids.operationId,
      })
      await this.settle(review, sequence)
    },

    /** The review's analysis sequence settled in the aggregate ledger. */
    async settle(reviewId: string, analysisSequence: number) {
      await db.insert(aiPropertyAggregateSettlements).values({
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        reviewId,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        analysisSequence,
        settledAt: NOW,
      })
    },

    async readyAnalysis(input: {
      reviewId: string
      analysisSequence: number
      operationId: string
    }) {
      await db.insert(aiReviewAnalyses).values({
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: input.analysisSequence,
        operationId: input.operationId,
        authorizationLineageId: scope.lineageId,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v2',
        status: 'ready',
        sentiment: 'positive',
        primaryCategory: 'service',
        attention: 'low',
        generatedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 365 * 24 * 60 * 60_000),
      })
    },

    async setHead(headSequence: number) {
      await db
        .update(reviewAiAnalysisHeads)
        .set({ headSequence })
        .where(
          and(
            eq(reviewAiAnalysisHeads.organizationId, scope.organizationId),
            eq(reviewAiAnalysisHeads.propertyId, scope.propertyId),
          ),
        )
    },

    async analysisSequenceOf(reviewId: string) {
      const [row] = await db
        .select({ analysisSequence: reviews.analysisSequence })
        .from(reviews)
        .where(eq(reviews.id, reviewId))
      return row?.analysisSequence
    },

    async backfillEvents() {
      const rows = await db
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, scope.organizationId),
            eq(outboxEvents.eventType, BACKFILL),
          ),
        )
      return rows.map((row) => row.payload as Record<string, unknown>)
    },
  }
}

describe('reopening Review Analysis abandoned by a transient failure (real PostgreSQL)', () => {
  const scope: Scope = {
    organizationId: organizationId('ai-reopen-adapter-test-org'),
    propertyId: propertyId('75000000-0000-4000-8000-000000000001'),
    lineageId: '75000000-0000-4000-8000-000000000002',
  }
  const db = getDb()
  const reopen = createAiReviewAnalysisReopenAdapter(db)
  const fixture = reviewFixture(scope)
  const review = (index: number) => uuid('75000001', index)
  const operation = (index: number) => uuid('75000002', index)
  const event = (index: number) => uuid('75000003', index)
  const ids = (index: number): OperationIds => ({
    operationId: operation(index),
    eventId: event(index),
  })

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearScope(scope)
    await seedEnabledProperty(scope)

    // 1: the beta drop. Settled without a result after the operation gave up
    //    as ambiguous.
    await fixture.review({ id: review(1), analysisSequence: 1 })
    await fixture.abandon(review(1), 1, 'operation_ambiguous', ids(1))
    // 2: refused by the deterministic redactor. Every retry would repeat it.
    await fixture.review({ id: review(2), analysisSequence: 2 })
    await fixture.abandon(review(2), 2, 'redaction_blocked', ids(2))
    // 3: analysed.
    await fixture.review({ id: review(3), analysisSequence: 3 })
    await fixture.analysed(review(3), 3, ids(3))
    // 4: abandoned again after it was already reopened the maximum number of
    //    times: one operation per earlier sequence, all given up on.
    const spentSequences = Array.from(
      { length: AI_REVIEW_ANALYSIS_MAX_REOPENS + 1 },
      (_, index) => 4 + index,
    )
    const current = spentSequences.at(-1) ?? 4
    await fixture.review({ id: review(4), analysisSequence: current })
    for (const sequence of spentSequences) {
      await fixture.abandon(
        review(4),
        sequence,
        'provider_unavailable',
        ids(100 + sequence),
      )
    }
    await fixture.setHead(20)
  })

  afterAll(async () => {
    await clearScope(scope)
    clearEventSchemas()
  })

  it('queues an abandoned review again under a fresh sequence, and nothing else', async () => {
    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 1, leftUnanalysed: 1 })

    expect(await fixture.analysisSequenceOf(review(1))).toBe(21)
    expect(await fixture.analysisSequenceOf(review(2))).toBe(2)
    expect(await fixture.analysisSequenceOf(review(3))).toBe(3)
    expect(await fixture.analysisSequenceOf(review(4))).toBe(
      4 + AI_REVIEW_ANALYSIS_MAX_REOPENS,
    )
    expect(await fixture.backfillEvents()).toEqual([
      expect.objectContaining({
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        reviewId: review(1),
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 21,
        correlationId: operation(1),
      }),
    ])
  })

  it('does not reopen a review twice while its fresh sequence is still open', async () => {
    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 0, leftUnanalysed: 1 })
    expect(await fixture.backfillEvents()).toHaveLength(1)
  })

  // Closed beta, 2026-10-24: the provider account ran out of credit for 40
  // hours, longer than the automatic reopens last, and ten text reviews stayed
  // settled without an analysis once it was topped up. The operator command
  // lists them and queues them again.
  it('lists the review that used every automatic reopen for an operator', async () => {
    const spentSequence = 4 + AI_REVIEW_ANALYSIS_MAX_REOPENS
    await expect(
      listSpentReviewAnalyses(db, { propertyId: scope.propertyId, limit: 50 }),
    ).resolves.toEqual([
      {
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        reviewId: review(4),
        operationId: operation(100 + spentSequence),
        failureCode: 'provider_unavailable',
        failedAt: NOW,
        analysisSequence: spentSequence,
      },
    ])
    await expect(
      listSpentReviewAnalyses(db, { propertyId: uuid('75000009', 1), limit: 50 }),
    ).resolves.toEqual([])
  })

  it('reopens it on an operator run, past the automatic budget, once', async () => {
    const spentSequence = 4 + AI_REVIEW_ANALYSIS_MAX_REOPENS
    await expect(
      reopenSpentReviewAnalyses(db, {
        propertyId: scope.propertyId,
        limit: 50,
        occurredAt: LATER,
      }),
    ).resolves.toEqual({
      reopened: [
        {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          reviewId: review(4),
          operationId: operation(100 + spentSequence),
          previousSequence: spentSequence,
          analysisSequence: 22,
        },
      ],
      failed: [],
    })

    expect(await fixture.analysisSequenceOf(review(4))).toBe(22)
    expect(await fixture.analysisSequenceOf(review(2))).toBe(2)
    expect(await fixture.backfillEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reviewId: review(4),
          analysisSequence: 22,
          correlationId: operation(100 + spentSequence),
        }),
      ]),
    )
    await expect(
      reopenSpentReviewAnalyses(db, {
        propertyId: scope.propertyId,
        limit: 50,
        occurredAt: LATER,
      }),
    ).resolves.toEqual({ reopened: [], failed: [] })
    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 0, leftUnanalysed: 0 })
  })

  it('leaves a Property alone once Review Analysis is switched off', async () => {
    await fixture.abandon(review(1), 21, 'operation_ambiguous', ids(21))
    await switchReviewAnalysisOff(scope)

    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 0, leftUnanalysed: 0 })
    expect(await fixture.analysisSequenceOf(review(1))).toBe(21)
  })
})

describe('Review Analysis enrollment catch-up with an abandoned review (real PostgreSQL)', () => {
  const scope: Scope = {
    organizationId: organizationId('ai-reopen-enrollment-test-org'),
    propertyId: propertyId('76100000-0000-4000-8000-000000000001'),
    lineageId: '76100000-0000-4000-8000-000000000002',
  }
  const triggerEventId = '76100000-0000-4000-8000-000000000003'
  const enrollmentId = '76100000-0000-4000-8000-000000000004'
  const analysedReview = '76100000-0000-4000-8000-000000000005'
  const droppedReview = '76100000-0000-4000-8000-000000000006'
  const refusedReview = '76100000-0000-4000-8000-000000000007'
  const expectedFence = {
    authorizationLineageId: scope.lineageId,
    authorizationStateVersion: 1,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    analysisStartSequence: 0,
  }
  const db = getDb()
  const enrollments = createReviewAnalysisEnrollmentAdapter(db, () => enrollmentId)
  const reopen = createAiReviewAnalysisReopenAdapter(db)
  const fixture = reviewFixture(scope)
  const reconcile = (occurredAt: Date) =>
    enrollments.reconcile({
      enrollmentId,
      organizationId: organizationId(scope.organizationId),
      expectedFence,
      correlationId: enrollmentId,
      occurredAt,
    })

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearScope(scope)
    await seedEnabledProperty(scope)
    await db.insert(outboxEvents).values({
      id: triggerEventId,
      eventType: 'identity.merchant_ai.changed',
      eventVersion: 1,
      payload: { state: 'enabled' },
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      sourceContext: 'identity',
      sourceAggregateId: scope.propertyId,
      createdAt: NOW,
    })
    await fixture.review({ id: analysedReview, analysisSequence: 0 })
    await fixture.review({ id: droppedReview, analysisSequence: 0 })
    await fixture.review({ id: refusedReview, analysisSequence: 0 })
  })

  afterAll(async () => {
    await clearScope(scope)
    clearEventSchemas()
  })

  it('stays running while an enrolled review was abandoned, and catches up once it is analysed', async () => {
    await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: triggerEventId,
      organizationId: organizationId(scope.organizationId),
      propertyId: propertyId(scope.propertyId),
      authorizationState: 'enabled',
      fence: { ...expectedFence, replyDraftingEpoch: 1, propertyTrendsEpoch: 1 },
      correlationId: null,
      occurredAt: NOW,
    })
    await expect(reconcile(NOW)).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 3,
    })
    const replayed = new Map(
      (await fixture.backfillEvents()).map((payload) => [
        String(payload.reviewId),
        Number(payload.analysisSequence),
      ]),
    )
    const analysedSequence = replayed.get(analysedReview) ?? 0
    const droppedSequence = replayed.get(droppedReview) ?? 0
    const refusedSequence = replayed.get(refusedReview) ?? 0

    // Every replayed review settles: one with its analysis, one after its
    // operation gave up as ambiguous (the beta drop), and one refused by the
    // deterministic redactor, which every retry would refuse again.
    await fixture.analysed(analysedReview, analysedSequence, {
      operationId: '76100000-0000-4000-8000-000000000010',
      eventId: '76100000-0000-4000-8000-000000000011',
    })
    await fixture.abandon(droppedReview, droppedSequence, 'operation_ambiguous', {
      operationId: '76100000-0000-4000-8000-000000000012',
      eventId: '76100000-0000-4000-8000-000000000013',
    })
    await fixture.abandon(refusedReview, refusedSequence, 'redaction_blocked', {
      operationId: '76100000-0000-4000-8000-000000000016',
      eventId: '76100000-0000-4000-8000-000000000017',
    })

    // Every replayed event has settled, but one review has no analysis and
    // nothing has judged it: the enrollment is not caught up.
    await expect(reconcile(LATER)).resolves.toEqual({ status: 'waiting_for_replay' })

    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 1, leftUnanalysed: 0 })
    const reopenedSequence = await fixture.analysisSequenceOf(droppedReview)
    expect(reopenedSequence).toBeGreaterThan(droppedSequence)
    // Queued again, not yet analysed: still not caught up.
    await expect(reconcile(LATER)).resolves.toEqual({ status: 'waiting_for_replay' })

    await fixture.analysed(droppedReview, reopenedSequence ?? 0, {
      operationId: '76100000-0000-4000-8000-000000000014',
      eventId: '76100000-0000-4000-8000-000000000015',
    })

    // Caught up with the refused review still unanalysed: it is settled as
    // not analysable, and waiting for it would never end.
    await expect(reconcile(LATER)).resolves.toMatchObject({
      status: 'caught_up',
      eligibleRevisionCount: 3,
    })
    expect(await fixture.analysisSequenceOf(refusedReview)).toBe(refusedSequence)
  })
})

// An operator kills an AI execution control and restores it. Each transition
// moves the control's generation, the operation's request fingerprint covers
// the generations, and its idempotency key is the review's event. So a review
// whose operation was claimed before the stop can only meet `conflict` after
// the restore. The analysis closes that operation as suspended; this suite
// runs what the store and the reopen pass then do with it.
describe('reopening a review whose operation was claimed before a control stop (real PostgreSQL)', () => {
  const scope: Scope = {
    organizationId: organizationId('ai-reopen-control-stop-test-org'),
    propertyId: propertyId('77100000-0000-4000-8000-000000000001'),
    lineageId: '77100000-0000-4000-8000-000000000002',
  }
  const heldReview = '77100000-0000-4000-8000-000000000003'
  const heldEvent = '77100000-0000-4000-8000-000000000004'
  const operationIds = [
    '77100000-0000-4000-8000-000000000005',
    '77100000-0000-4000-8000-000000000006',
  ]
  const db = getDb()
  const operations = createAiOperationStoreAdapter(db, () => {
    const next = operationIds.shift()
    if (next === undefined) throw new Error('No operation id left for this test')
    return next
  })
  const reopen = createAiReviewAnalysisReopenAdapter(db)
  const fixture = reviewFixture(scope)
  const provenance = { digest: 'c'.repeat(64), byteCount: 24 }

  /** The held review's analysis request as the use case builds and fingerprints it. */
  function requestUnder(stopFence: AiExecutionStopFence) {
    const event = {
      organizationId: organizationId(scope.organizationId),
      propertyId: propertyId(scope.propertyId),
      reviewId: reviewId(heldReview),
      eventEnvelopeId: heldEvent,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
    }
    const subject = { digest: 'd'.repeat(64), keyVersion: 'ai-reopen-test-v1' }
    const identity = analysisOperationIdentity(event, subject, NOW.getTime())
    const binding = analysisExecutionBinding({
      input: event,
      authorization: authorizationHead(scope),
      authorizationLineageId: scope.lineageId,
      operationProfile: {
        profileVersion: 'review-analysis-v3',
        capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
      },
      reviewAnalysisEpoch: 1,
      evaluatedLanguage: 'en',
      reviewedAtEpochMillis: NOW.getTime(),
      profile: {
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        countryCode: 'BG',
        timezone: 'Europe/Sofia',
        processingRegion: 'global',
        routingPolicyVersion: 1,
        sourceEpoch: 0,
        profileVersion: 1,
        lifecycleState: 'active',
      },
      subjectHmacKeyVersion: subject.keyVersion,
      stopFence,
    })
    return { identity, binding, provenance }
  }

  function claim(request: ReturnType<typeof requestUnder>, at: Date) {
    return operations.claim({
      identity: request.identity,
      binding: request.binding,
      idempotencyKey: `analysis:${heldEvent}`,
      requestFingerprint: aiRequestFingerprint(request),
      sourceProvenance: request.provenance,
      vocabularyHints: resolveReviewPropertyContext('Hotel').hintIdentity,
      providerLineage: {
        providerId: 'openai',
        model: 'synthetic-model-2026-10-01',
        requestProfileVersion: 'synthetic-request-profile-v1',
        requestProfileDigest: '1'.repeat(64),
      },
      normalization: {
        version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
        digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
      },
      nowEpochMillis: at.getTime(),
      expiresAtEpochMillis: at.getTime() + 24 * 60 * 60_000,
    })
  }

  async function storedOperation(id: string) {
    const [row] = await db
      .select({ state: aiOperations.state, failureCode: aiOperations.failureCode })
      .from(aiOperations)
      .where(eq(aiOperations.id, id))
    return row
  }

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearScope(scope)
    await seedEnabledProperty(scope)
    await fixture.review({ id: heldReview, analysisSequence: 1 })
    await fixture.setHead(1)
  })

  afterAll(async () => {
    await clearScope(scope)
    clearEventSchemas()
  })

  it('answers conflict with the stored operation, closes it as suspended, and reopens the review', async () => {
    const claimedUnder = await readCurrentStopFence(db)
    const created = await claim(requestUnder(claimedUnder), NOW)
    // The kill and the restore: two transitions of the capability control.
    const restored = requestUnder({
      ...claimedUnder,
      capabilityGeneration: claimedUnder.capabilityGeneration + 2,
    })

    const afterRestore = await claim(restored, LATER)

    expect(created).toMatchObject({ status: 'created', operation: { state: 'pending' } })
    expect(afterRestore).toMatchObject({
      status: 'conflict',
      operation: {
        id: created.operation.id,
        state: 'pending',
        executionAttempt: 0,
        failureCode: null,
        binding: { stopFence: claimedUnder },
      },
    })
    if (afterRestore.status !== 'conflict') return

    await expect(
      resolveAnalysisClaimConflict(operations, {
        existing: afterRestore.operation,
        request: restored,
        organizationId: organizationId(scope.organizationId),
        nowEpochMillis: LATER.getTime(),
      }),
    ).resolves.toEqual({
      operationId: afterRestore.operation.id,
      dispositionCode: 'operation_abandoned',
    })
    await expect(storedOperation(afterRestore.operation.id)).resolves.toEqual({
      state: 'failed',
      failureCode: 'execution_suspended',
    })

    // The analysis settles the sequence and the drain removes the backlog
    // entry; the reopen pass then takes the review at its next sweep.
    await fixture.settle(heldReview, 1)
    await expect(
      reopen.reopenAbandoned({ limit: 50, occurredAt: LATER }),
    ).resolves.toEqual({ reopened: 1, leftUnanalysed: 0 })
    expect(await fixture.analysisSequenceOf(heldReview)).toBe(2)
    expect(await fixture.backfillEvents()).toEqual([
      expect.objectContaining({
        reviewId: heldReview,
        analysisSequence: 2,
        correlationId: afterRestore.operation.id,
      }),
    ])
  })
})
