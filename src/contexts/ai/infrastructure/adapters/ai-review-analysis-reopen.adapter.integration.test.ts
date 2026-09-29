// Closed beta, 2026-09-29: an import burst left three text reviews of one
// Property settled without an analysis. Their operations had given up with
// `operation_ambiguous` (nobody had judged the reviews), the backlog was empty
// and the first-enablement enrollment still recorded itself caught up, so
// nothing would ever analyse them. These suites reproduce that end state in
// PostgreSQL and pin the safety net: the reopen pass queues such reviews again,
// and an enrollment does not catch up while one of its reviews is waiting.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  aiExecutionControlHeads,
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
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { AI_REVIEW_ANALYSIS_MAX_REOPENS } from '../../domain/review-analysis-reopen'
import { createAiReviewAnalysisReopenAdapter } from './ai-review-analysis-reopen.adapter'
import { createReviewAnalysisEnrollmentAdapter } from './ai-review-analysis-enrollment.adapter'

const NOW = new Date('2026-09-29T17:37:00.000Z')
const LATER = new Date('2026-09-29T17:45:00.000Z')
const BACKFILL = 'ai.review_analysis.backfill_requested'

type Scope = Readonly<{ organizationId: string; propertyId: string; lineageId: string }>

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
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${scope.organizationId}, 'AI reopen test', ${scope.organizationId}, ${NOW})
  `)
  await db.insert(properties).values({
    id: scope.propertyId,
    organizationId: scope.organizationId,
    name: 'AI reopen test property',
    slug: `ai-reopen-${scope.propertyId.slice(0, 8)}`,
    timezone: 'Europe/Sofia',
    countryCode: 'BG',
    profileVersion: 1,
    sourceEpoch: 0,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    sourceEpoch: 0,
    headSequence: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  const authorization = authorizationHead(scope)
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...authorization,
      stateVersion: 1,
      transitionKind: 'enable',
      actorUserId: 'ai-reopen-test-actor',
      reasonCode: 'merchant_enabled',
      idempotencyKey: `ai-reopen-enable-${scope.propertyId}`,
      requestHash: 'c'.repeat(64),
      occurredAt: NOW,
    })
    await tx.insert(merchantAiEnablement).values({
      ...authorization,
      stateVersion: 1,
      updatedBy: 'ai-reopen-test-actor',
      updatedAt: NOW,
    })
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
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    redactionProfileFamily: 'gbp-review-global-v1',
  }
}

function reviewFixture(scope: Scope) {
  const db = getDb()
  return {
    async review(input: { id: string; analysisSequence: number; text?: string | null }) {
      await db.insert(reviews).values({
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
      const controls = await db
        .select({
          scopeKey: aiExecutionControlHeads.scopeKey,
          controlId: aiExecutionControlHeads.controlId,
          generation: aiExecutionControlHeads.generation,
        })
        .from(aiExecutionControlHeads)
      const control = (scopeKey: string) => {
        const found = controls.find((candidate) => candidate.scopeKey === scopeKey)
        if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
        return found
      }
      const globalControl = control('global')
      const providerControl = control(
        `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
      )
      const capabilityControl = control('capability:review_analysis')
      await db.insert(aiOperations).values({
        id: input.id,
        idempotencyScope: `analysis:${input.id}`,
        idempotencyKey: `analysis:${input.originEventId}`,
        requestFingerprint: 'b'.repeat(64),
        sourceDigest: 'c'.repeat(64),
        sourceByteCount: 24,
        command: 'analysis',
        capability: 'review_analysis',
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        actorUserId: null,
        systemPrincipal: 'review_event_consumer',
        reviewId: input.reviewId,
        originEventId: input.originEventId,
        subjectHmac: 'd'.repeat(64),
        subjectHmacKeyVersion: 'ai-reopen-test-v1',
        sourceEpoch: 0,
        sourceRevision: 1,
        reviewedAtEpochMillis: NOW.getTime(),
        analysisSequence: input.analysisSequence,
        authorizationLineageId: scope.lineageId,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        evaluatedLanguage: 'en',
        propertyProfileVersion: 1,
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
        operationProfileVersion: 'review-analysis-v2',
        capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: 'e'.repeat(64),
        redactionProfileVersion: 'gbp-review-global-v1',
        globalControlId: globalControl.controlId,
        globalControlGeneration: globalControl.generation,
        providerControlId: providerControl.controlId,
        providerControlGeneration: providerControl.generation,
        capabilityControlId: capabilityControl.controlId,
        capabilityControlGeneration: capabilityControl.generation,
        capabilityFences: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
        routeKey: 'review-analysis',
        state: input.state,
        executionAttempt: 4,
        failureCode: input.failureCode ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
      })
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

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearScope(scope)
    await seedEnabledProperty(scope)

    // 1: the beta drop. Settled without a result after the operation gave up
    //    as ambiguous.
    await fixture.review({ id: review(1), analysisSequence: 1 })
    await fixture.operation({
      id: operation(1),
      reviewId: review(1),
      analysisSequence: 1,
      originEventId: event(1),
      state: 'failed',
      failureCode: 'operation_ambiguous',
    })
    await fixture.settle(review(1), 1)
    // 2: refused by the deterministic redactor. Every retry would repeat it.
    await fixture.review({ id: review(2), analysisSequence: 2 })
    await fixture.operation({
      id: operation(2),
      reviewId: review(2),
      analysisSequence: 2,
      originEventId: event(2),
      state: 'failed',
      failureCode: 'redaction_blocked',
    })
    await fixture.settle(review(2), 2)
    // 3: analysed.
    await fixture.review({ id: review(3), analysisSequence: 3 })
    await fixture.operation({
      id: operation(3),
      reviewId: review(3),
      analysisSequence: 3,
      originEventId: event(3),
      state: 'succeeded',
    })
    await fixture.readyAnalysis({
      reviewId: review(3),
      analysisSequence: 3,
      operationId: operation(3),
    })
    await fixture.settle(review(3), 3)
    // 4: abandoned again after it was already reopened the maximum number of
    //    times: one operation per earlier sequence, all given up on.
    const spentSequences = Array.from(
      { length: AI_REVIEW_ANALYSIS_MAX_REOPENS + 1 },
      (_, index) => 4 + index,
    )
    const current = spentSequences.at(-1) ?? 4
    await fixture.review({ id: review(4), analysisSequence: current })
    for (const sequence of spentSequences) {
      await fixture.operation({
        id: operation(100 + sequence),
        reviewId: review(4),
        analysisSequence: sequence,
        originEventId: event(100 + sequence),
        state: 'failed',
        failureCode: 'provider_unavailable',
      })
      await fixture.settle(review(4), sequence)
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

  it('leaves a Property alone once Review Analysis is switched off', async () => {
    await fixture.operation({
      id: operation(21),
      reviewId: review(1),
      analysisSequence: 21,
      originEventId: event(21),
      state: 'failed',
      failureCode: 'operation_ambiguous',
    })
    await fixture.settle(review(1), 21)
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
    await fixture.operation({
      id: '76100000-0000-4000-8000-000000000010',
      reviewId: analysedReview,
      analysisSequence: analysedSequence,
      originEventId: '76100000-0000-4000-8000-000000000011',
      state: 'succeeded',
    })
    await fixture.readyAnalysis({
      reviewId: analysedReview,
      analysisSequence: analysedSequence,
      operationId: '76100000-0000-4000-8000-000000000010',
    })
    await fixture.settle(analysedReview, analysedSequence)
    await fixture.operation({
      id: '76100000-0000-4000-8000-000000000012',
      reviewId: droppedReview,
      analysisSequence: droppedSequence,
      originEventId: '76100000-0000-4000-8000-000000000013',
      state: 'failed',
      failureCode: 'operation_ambiguous',
    })
    await fixture.settle(droppedReview, droppedSequence)
    await fixture.operation({
      id: '76100000-0000-4000-8000-000000000016',
      reviewId: refusedReview,
      analysisSequence: refusedSequence,
      originEventId: '76100000-0000-4000-8000-000000000017',
      state: 'failed',
      failureCode: 'redaction_blocked',
    })
    await fixture.settle(refusedReview, refusedSequence)

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

    await fixture.operation({
      id: '76100000-0000-4000-8000-000000000014',
      reviewId: droppedReview,
      analysisSequence: reopenedSequence ?? 0,
      originEventId: '76100000-0000-4000-8000-000000000015',
      state: 'succeeded',
    })
    await fixture.readyAnalysis({
      reviewId: droppedReview,
      analysisSequence: reopenedSequence ?? 0,
      operationId: '76100000-0000-4000-8000-000000000014',
    })
    await fixture.settle(droppedReview, reopenedSequence ?? 0)

    // Caught up with the refused review still unanalysed: it is settled as
    // not analysable, and waiting for it would never end.
    await expect(reconcile(LATER)).resolves.toMatchObject({
      status: 'caught_up',
      eligibleRevisionCount: 3,
    })
    expect(await fixture.analysisSequenceOf(refusedReview)).toBe(refusedSequence)
  })
})
