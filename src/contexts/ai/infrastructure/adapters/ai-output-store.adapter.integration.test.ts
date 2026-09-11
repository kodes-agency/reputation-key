import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiPropertyAggregateContributionAspects,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiPropertyDailyAspectAggregates,
  aiPropertyDailyAggregates,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisAspects,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import type { AiOperationId } from '../../domain/types'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'

const NOW = new Date('2026-09-08T10:00:00.000Z')
const COMPLETED_AT = new Date('2026-09-08T10:05:00.000Z')
const CONTENT_EXPIRES_AT = new Date('2026-10-08T10:00:00.000Z')
const ANALYSIS_EXPIRES_AT = new Date('2028-09-07T10:05:00.000Z')
const OPERATION_EXPIRES_AT = new Date('2026-09-09T10:00:00.000Z')
const REVIEWED_AT = new Date('2026-09-07T10:00:00.000Z')

const ORGANIZATION_ID = organizationId('ai-output-store-test-org')
const PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '75000000-0000-4000-8000-000000000002'
const REVIEW_A_ID = reviewId('75000000-0000-4000-8000-000000000003')
const REVIEW_B_ID = reviewId('75000000-0000-4000-8000-000000000004')
const OPERATION_ID = '75000000-0000-4000-8000-000000000005' as AiOperationId
const ORIGIN_EVENT_ID = '75000000-0000-4000-8000-000000000006'
const SUPERSEDED_OPERATION_ID = '75000000-0000-4000-8000-000000000007' as AiOperationId
const LATEST_OPERATION_ID = '75000000-0000-4000-8000-000000000008' as AiOperationId
const SUPERSEDED_EVENT_ID = '75000000-0000-4000-8000-000000000009'
const LATEST_EVENT_ID = '75000000-0000-4000-8000-000000000010'
const ACTOR_USER_ID = 'ai-output-store-test-actor'
const SOURCE_EPOCH = 0
const SOURCE_REVISION = 1
const REVIEW_A_SOURCE_DIGEST = 'a'.repeat(64)
const REVIEW_B_SOURCE_DIGEST = 'b'.repeat(64)
const SOURCE_BYTE_COUNT = 20

const CONTROL_SCOPE_KEYS = [
  'global',
  `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
  'capability:review_analysis',
] as const

type ControlScopeKey = (typeof CONTROL_SCOPE_KEYS)[number]
type ControlHead = Readonly<{
  scopeKey: ControlScopeKey
  controlId: string
  generation: number
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
}>

type ControlPosture = Pick<ControlHead, 'executionState' | 'admissionState'>

async function readControlHeads(db: Database): Promise<readonly ControlHead[]> {
  const rows = await db
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(inArray(aiExecutionControlHeads.scopeKey, [...CONTROL_SCOPE_KEYS]))

  return CONTROL_SCOPE_KEYS.map((scopeKey) => {
    const row = rows.find((candidate) => candidate.scopeKey === scopeKey)
    if (!row) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    if (
      (row.executionState !== 'enabled' && row.executionState !== 'killed') ||
      (row.admissionState !== 'accepting' && row.admissionState !== 'draining')
    ) {
      throw new Error(`AI execution control ${scopeKey} has an invalid posture`)
    }
    return {
      scopeKey,
      controlId: row.controlId,
      generation: row.generation,
      executionState: row.executionState,
      admissionState: row.admissionState,
    }
  })
}

async function transitionControl(
  db: Database,
  scopeKey: ControlScopeKey,
  posture: ControlPosture,
): Promise<void> {
  const [head] = await db
    .select()
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, scopeKey))
    .limit(1)
  if (!head) throw new Error(`AI execution control ${scopeKey} is not seeded`)
  if (
    head.executionState === posture.executionState &&
    head.admissionState === posture.admissionState
  ) {
    return
  }

  const generation = head.generation + 1
  const occurredAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(aiExecutionControlTransitions).values({
      controlId: head.controlId,
      generation,
      predecessorGeneration: head.generation,
      scopeKey: head.scopeKey,
      scopeKind: head.scopeKind,
      scopeValue: head.scopeValue,
      executionState: posture.executionState,
      admissionState: posture.admissionState,
      reasonCode: 'integration_test_transition',
      actorUserId: ACTOR_USER_ID,
      ticketReference: `ai-output-store-test-${scopeKey}-${generation}`,
      candidateReleaseSha: null,
      occurredAt,
    })
    const updated = await tx
      .update(aiExecutionControlHeads)
      .set({
        generation,
        executionState: posture.executionState,
        admissionState: posture.admissionState,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(aiExecutionControlHeads.scopeKey, scopeKey),
          eq(aiExecutionControlHeads.generation, head.generation),
        ),
      )
      .returning({ scopeKey: aiExecutionControlHeads.scopeKey })
    if (updated.length !== 1) throw new Error(`AI execution control ${scopeKey} changed`)
  })
}

function requireControl(
  controls: readonly ControlHead[],
  scopeKey: ControlScopeKey,
): ControlHead {
  const control = controls.find((candidate) => candidate.scopeKey === scopeKey)
  if (!control) throw new Error(`AI execution control ${scopeKey} is not seeded`)
  return control
}

describe.sequential('AI output store analysis persistence (real PostgreSQL)', () => {
  const db = getDb()
  const outputs = createAiOutputStoreAdapter(db)
  let initialControls: readonly ControlHead[] = []

  const clear = async () => {
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    initialControls = await readControlHeads(db)
    for (const control of initialControls) {
      await transitionControl(db, control.scopeKey, {
        executionState: 'enabled',
        admissionState: 'accepting',
      })
    }

    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI output store test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI output store test property',
      slug: 'ai-output-store-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: 2,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: LINEAGE_ID,
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
        authorizedSourceEpoch: SOURCE_EPOCH,
        analysisStartSequence: 0,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: ACTOR_USER_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-output-store-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: SOURCE_EPOCH,
        analysisStartSequence: 0,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: ACTOR_USER_ID,
        updatedAt: NOW,
      })
    })
    await db.insert(aiPropertyProcessingProfiles).values({
      propertyId: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      countryCode: 'US',
      timezone: 'America/New_York',
      processingRegion: 'global',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      sourceEpoch: SOURCE_EPOCH,
      profileVersion: 1,
      lifecycleState: 'active',
      updatedAt: NOW,
    })
    await db.insert(reviews).values([
      {
        id: REVIEW_A_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: 'ai-output-store-review-a',
        reviewerName: 'Synthetic reviewer A',
        rating: 5,
        text: 'Synthetic review A',
        languageCode: 'en',
        reviewedAt: REVIEWED_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        aiSourceByteLength: SOURCE_BYTE_COUNT,
        aiSourceDigest: REVIEW_A_SOURCE_DIGEST,
      },
      {
        id: REVIEW_B_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: 'ai-output-store-review-b',
        reviewerName: 'Synthetic reviewer B',
        rating: 4,
        text: 'Synthetic review B',
        languageCode: 'en',
        reviewedAt: REVIEWED_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 2,
        aiSourceByteLength: SOURCE_BYTE_COUNT,
        aiSourceDigest: REVIEW_B_SOURCE_DIGEST,
      },
    ])
    await db.insert(materialReviewRevisions).values([
      {
        reviewId: REVIEW_A_ID,
        revision: SOURCE_REVISION,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        normalizationVersion: 'legacy-unverified-v0',
        rating: 5,
        normalizedText: 'Synthetic review A',
      },
      {
        reviewId: REVIEW_B_ID,
        revision: SOURCE_REVISION,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        normalizationVersion: 'legacy-unverified-v0',
        rating: 4,
        normalizedText: 'Synthetic review B',
      },
    ])

    const activeControls = await readControlHeads(db)
    const globalControl = requireControl(activeControls, 'global')
    const providerControl = requireControl(
      activeControls,
      `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
    )
    const capabilityControl = requireControl(activeControls, 'capability:review_analysis')
    await db.insert(aiOperations).values({
      id: OPERATION_ID,
      idempotencyScope: `analysis:${OPERATION_ID}`,
      idempotencyKey: OPERATION_ID,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: REVIEW_A_SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTE_COUNT,
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: REVIEW_A_ID,
      originEventId: ORIGIN_EVENT_ID,
      subjectHmac: 'd'.repeat(64),
      subjectHmacKeyVersion: 'ai-output-store-test-v1',
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      reviewedAtEpochMillis: REVIEWED_AT.getTime(),
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
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
      capabilityFences: {
        capability: 'review_analysis',
        reviewAnalysisEpoch: 1,
      },
      routeKey: 'review-analysis',
      state: 'executing',
      executionAttempt: 1,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: OPERATION_EXPIRES_AT,
    })
  })

  beforeEach(async () => {
    await db
      .delete(aiReviewAnalyses)
      .where(
        and(
          eq(aiReviewAnalyses.organizationId, ORGANIZATION_ID),
          eq(aiReviewAnalyses.propertyId, PROPERTY_ID),
        ),
      )
    await db
      .delete(aiPropertyDailyAggregates)
      .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
    await db
      .update(aiOperations)
      .set({ state: 'executing', updatedAt: NOW })
      .where(eq(aiOperations.id, OPERATION_ID))
    await db
      .update(reviews)
      .set({ analysisSequence: 1 })
      .where(eq(reviews.id, REVIEW_A_ID))
  })

  afterAll(async () => {
    try {
      await clear()
    } finally {
      for (const control of initialControls) {
        await transitionControl(db, control.scopeKey, control)
      }
    }
  })

  const storeReviewA = () =>
    outputs.storeAnalysis({
      operationId: OPERATION_ID,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
        inputTokens: 20,
        outputTokens: 10,
        completedAtEpochMillis: COMPLETED_AT.getTime(),
      },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_A_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      analysisProfileVersion: 'review-analysis-v2',
      result: {
        status: 'ready',
        derivative: {
          sentiment: 'positive',
          primaryCategory: ASPECT_TAXONOMY_V1[0],
          attention: 'low',
          aspects: [
            { aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', intensity: 75 },
          ],
          issueLabel: 'helpful service',
        },
      },
      generatedAtEpochMillis: COMPLETED_AT.getTime(),
      expiresAtEpochMillis: ANALYSIS_EXPIRES_AT.getTime(),
    })

  it('stores a paid analysis when another review owns the property head sequence', async () => {
    await expect(storeReviewA()).resolves.toBe(true)

    const [analysis] = await db
      .select({
        reviewId: aiReviewAnalyses.reviewId,
        analysisSequence: aiReviewAnalyses.analysisSequence,
        status: aiReviewAnalyses.status,
        sentiment: aiReviewAnalyses.sentiment,
        primaryCategory: aiReviewAnalyses.primaryCategory,
        attention: aiReviewAnalyses.attention,
        issueLabel: aiReviewAnalyses.issueLabel,
      })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.operationId, OPERATION_ID))
    expect(analysis).toEqual({
      reviewId: REVIEW_A_ID,
      analysisSequence: 1,
      status: 'ready',
      sentiment: 'positive',
      primaryCategory: ASPECT_TAXONOMY_V1[0],
      attention: 'low',
      issueLabel: 'helpful service',
    })
    const aspects = await db
      .select({
        aspect: aiReviewAnalysisAspects.aspect,
        polarity: aiReviewAnalysisAspects.polarity,
        intensity: aiReviewAnalysisAspects.intensity,
      })
      .from(aiReviewAnalysisAspects)
      .where(
        and(
          eq(aiReviewAnalysisAspects.organizationId, ORGANIZATION_ID),
          eq(aiReviewAnalysisAspects.propertyId, PROPERTY_ID),
          eq(aiReviewAnalysisAspects.reviewId, REVIEW_A_ID),
        ),
      )
    expect(aspects).toEqual([
      { aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', intensity: 75 },
    ])

    const [operation] = await db
      .select({ state: aiOperations.state, updatedAt: aiOperations.updatedAt })
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
    expect(operation).toEqual({
      state: 'succeeded_pending_delivery',
      updatedAt: COMPLETED_AT,
    })
  })
  it('exposes every unreceipted terminal analysis failure to the reaper', async () => {
    await db
      .update(aiOperations)
      .set({
        state: 'failed',
        failureCode: 'output_invalid',
        nextAttemptAt: null,
        updatedAt: COMPLETED_AT,
      })
      .where(eq(aiOperations.id, OPERATION_ID))

    const operations = createAiOperationStoreAdapter(db, () => {
      throw new Error('Recovery does not create operation ids')
    })
    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: COMPLETED_AT.getTime(),
        executionHorizonMillis: 15 * 60_000,
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        operationId: OPERATION_ID,
        state: 'failed',
        failureCode: 'output_invalid',
        analysis: expect.objectContaining({
          eventEnvelopeId: ORIGIN_EVENT_ID,
          analysisSequence: 1,
        }),
      }),
    ])
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
    const operations = createAiOperationStoreAdapter(db, () => {
      throw new Error('Recovery does not create operation ids')
    })
    const executionHorizonMillis = 15 * 60_000

    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: NOW.getTime() + executionHorizonMillis + 1,
        executionHorizonMillis,
        limit: 10,
      }),
    ).resolves.toEqual([])
    await expect(
      operations.listExpiredExecutions({
        nowEpochMillis: OPERATION_EXPIRES_AT.getTime(),
        executionHorizonMillis,
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ operationId: OPERATION_ID, state: 'pending' }),
    ])
  })

  it('reads current v1 analysis evidence with no aspect children', async () => {
    await expect(storeReviewA()).resolves.toBe(true)
    await db
      .update(aiReviewAnalyses)
      .set({ analysisProfileVersion: 'review-analysis-v1' })
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_A_ID))
    await db
      .delete(aiReviewAnalysisAspects)
      .where(eq(aiReviewAnalysisAspects.reviewId, REVIEW_A_ID))

    await expect(
      outputs.readAnalysisForDelivery(
        {
          organizationId: ORGANIZATION_ID,
          actorUserId: userId(ACTOR_USER_ID),
          propertyId: PROPERTY_ID,
          reviewId: REVIEW_A_ID,
          authorizationLineageId: LINEAGE_ID,
          reviewAnalysisEpoch: 1,
          sourceEpoch: SOURCE_EPOCH,
          sourceRevision: SOURCE_REVISION,
          analysisSequence: 1,
          propertyProfileVersion: 1,
          analysisProfileVersion: 'review-analysis-v1',
          nowEpochMillis: COMPLETED_AT.getTime(),
        },
        async (result) => result,
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      analysisProfileVersion: 'review-analysis-v1',
      aspects: [],
    })
  })

  it('projects v2 aspects through per-review and daily aggregate rows', async () => {
    await expect(storeReviewA()).resolves.toBe(true)
    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    const windowRequest = {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      startLocalDate: '2026-09-07',
      endLocalDate: '2026-09-07',
    }
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })
    await expect(aggregates.readWindow(windowRequest)).resolves.toMatchObject({
      coverage: {
        settledAnalysisCount: 1,
        expectedAnalysisCount: 2,
        awaitingAnalysisCount: 1,
      },
      days: [{ localDate: '2026-09-07', reviewCount: 1 }],
      analyzedReviews: [{ reviewId: REVIEW_A_ID }],
    })
    await expect(
      aggregates.advanceWithoutAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_B_ID,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        analysisSequence: 2,
        propertyProfileVersion: 1,
        dispositionCode: 'provider_deleted',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 2 })

    const contributionAspects = await db
      .select({
        aspect: aiPropertyAggregateContributionAspects.aspect,
        polarity: aiPropertyAggregateContributionAspects.polarity,
        intensity: aiPropertyAggregateContributionAspects.intensity,
      })
      .from(aiPropertyAggregateContributionAspects)
      .where(eq(aiPropertyAggregateContributionAspects.reviewId, REVIEW_A_ID))
    expect(contributionAspects).toEqual([
      { aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', intensity: 75 },
    ])
    const dailyAspects = await db
      .select({
        aspect: aiPropertyDailyAspectAggregates.aspect,
        polarity: aiPropertyDailyAspectAggregates.polarity,
        mentionCount: aiPropertyDailyAspectAggregates.mentionCount,
      })
      .from(aiPropertyDailyAspectAggregates)
      .where(eq(aiPropertyDailyAspectAggregates.propertyId, PROPERTY_ID))
    expect(dailyAspects).toEqual([
      { aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', mentionCount: 1 },
    ])

    const window = await aggregates.readWindow(windowRequest)
    expect(window?.coverage).toEqual({
      settledAnalysisCount: 2,
      expectedAnalysisCount: 2,
      awaitingAnalysisCount: 0,
    })
    expect(window?.days).toEqual([
      expect.objectContaining({
        localDate: '2026-09-07',
        aspectCounts: [{ aspect: 'service', polarity: 'positive', count: 1 }],
      }),
    ])
    expect(window?.analyzedReviews).toEqual([
      expect.objectContaining({
        reviewId: REVIEW_A_ID,
        aspects: [{ aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', intensity: 75 }],
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
    await expect(storeReviewA()).resolves.toBe(true)
    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })

    // Production reaches the rolled generation by settling into it. Use the
    // no-result path so the head is created exactly as a real profile bump
    // would create it, without needing a second stored analysis.
    await expect(
      aggregates.advanceWithoutAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_B_ID,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        analysisSequence: 2,
        propertyProfileVersion: 2,
        dispositionCode: 'provider_deleted',
      }),
    ).resolves.toMatchObject({ status: 'applied' })

    const rolledWindow = await aggregates.readWindow({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 2,
      startLocalDate: '2026-09-07',
      endLocalDate: '2026-09-07',
    })

    // Review A's analysis lives in profile generation 1 only, so generation 2
    // holds one settlement, not two. Reporting two would claim the window is
    // complete while its aspect rows are empty.
    expect(rolledWindow?.coverage.settledAnalysisCount).toBe(1)
    expect(rolledWindow?.coverage.awaitingAnalysisCount).toBe(1)
    expect(rolledWindow?.days ?? []).toEqual([])
  })

  it('reads current v1 analysis evidence that predates aspect children', async () => {
    await expect(storeReviewA()).resolves.toBe(true)
    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })
    await expect(
      aggregates.advanceWithoutAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_B_ID,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        analysisSequence: 2,
        propertyProfileVersion: 1,
        dispositionCode: 'provider_deleted',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 2 })

    await db
      .update(aiReviewAnalyses)
      .set({ analysisProfileVersion: 'review-analysis-v1' })
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_A_ID))
    await db
      .delete(aiReviewAnalysisAspects)
      .where(eq(aiReviewAnalysisAspects.reviewId, REVIEW_A_ID))
    await db
      .delete(aiPropertyAggregateContributionAspects)
      .where(eq(aiPropertyAggregateContributionAspects.reviewId, REVIEW_A_ID))
    await db
      .delete(aiPropertyDailyAspectAggregates)
      .where(eq(aiPropertyDailyAspectAggregates.propertyId, PROPERTY_ID))

    await expect(
      aggregates.readWindow({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        startLocalDate: '2026-09-07',
        endLocalDate: '2026-09-07',
      }),
    ).resolves.toMatchObject({
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
    const [baseOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
      .limit(1)
    if (!baseOperation) throw new Error('Missing aggregate convergence fixture')

    const fixture = Array.from({ length: 20 }, (_, index) => {
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
        polarity: index % 3 === 0 ? 'positive' : index % 3 === 1 ? 'neutral' : 'negative',
        intensity: index % 3 === 0 ? 70 : index % 3 === 1 ? 0 : -70,
      }
    })
    await db.insert(reviews).values(
      fixture.map((row) => ({
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
      })),
    )
    await db.insert(materialReviewRevisions).values(
      fixture.map((row) => ({
        reviewId: row.reviewId,
        revision: SOURCE_REVISION,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        normalizationVersion: 'legacy-unverified-v0',
        rating: row.rating,
        normalizedText: `Convergence review ${row.sequence}`,
      })),
    )
    await db.insert(aiOperations).values(
      fixture.map((row) => ({
        ...baseOperation,
        id: row.operationId,
        idempotencyScope: `analysis:${row.operationId}`,
        idempotencyKey: row.operationId,
        reviewId: row.reviewId,
        originEventId: row.eventId,
        analysisSequence: row.sequence,
      })),
    )
    await db.insert(aiReviewAnalyses).values(
      fixture.map((row) => ({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: row.reviewId,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: row.sequence,
        operationId: row.operationId,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v2',
        status: 'ready',
        unavailableReason: null,
        sentiment: row.sentiment,
        primaryCategory: row.aspect,
        issueLabel: null,
        attention: row.attention,
        generatedAt: COMPLETED_AT,
        expiresAt: ANALYSIS_EXPIRES_AT,
      })),
    )
    await db.insert(aiReviewAnalysisAspects).values(
      fixture.map((row) => ({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: row.reviewId,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: row.sequence,
        aspect: row.aspect,
        polarity: row.polarity,
        intensity: row.intensity,
      })),
    )

    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    const apply = async (row: (typeof fixture)[number]) =>
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: row.reviewId,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: row.sequence,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      })
    const resetAggregate = async () => {
      await db
        .delete(aiPropertyDailyAspectAggregates)
        .where(eq(aiPropertyDailyAspectAggregates.propertyId, PROPERTY_ID))
      await db
        .delete(aiPropertyDailyAggregates)
        .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID))
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
    const snapshot = async () => {
      const [daily] = await db
        .select({
          reviewCount: aiPropertyDailyAggregates.reviewCount,
          ratingSum: aiPropertyDailyAggregates.ratingSum,
          positiveCount: aiPropertyDailyAggregates.positiveCount,
          neutralCount: aiPropertyDailyAggregates.neutralCount,
          negativeCount: aiPropertyDailyAggregates.negativeCount,
          mixedCount: aiPropertyDailyAggregates.mixedCount,
          urgentCount: aiPropertyDailyAggregates.urgentCount,
          highCount: aiPropertyDailyAggregates.highCount,
          mediumCount: aiPropertyDailyAggregates.mediumCount,
          lowCount: aiPropertyDailyAggregates.lowCount,
        })
        .from(aiPropertyDailyAggregates)
        .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID))
      const aspects = await db
        .select({
          aspect: aiPropertyDailyAspectAggregates.aspect,
          polarity: aiPropertyDailyAspectAggregates.polarity,
          mentionCount: aiPropertyDailyAspectAggregates.mentionCount,
        })
        .from(aiPropertyDailyAspectAggregates)
        .where(eq(aiPropertyDailyAspectAggregates.propertyId, PROPERTY_ID))
        .orderBy(
          aiPropertyDailyAspectAggregates.aspect,
          aiPropertyDailyAspectAggregates.polarity,
        )
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

    for (const row of fixture) {
      await expect(apply(row)).resolves.toMatchObject({ status: 'applied' })
    }
    const sequential = await snapshot()

    await resetAggregate()
    const shuffled = [...fixture].sort(
      (left, right) => ((left.sequence * 7) % 20) - ((right.sequence * 7) % 20),
    )
    for (const row of shuffled) {
      await expect(apply(row)).resolves.toMatchObject({ status: 'applied' })
    }

    expect(await snapshot()).toEqual(sequential)
    expect(sequential).toMatchObject({
      daily: { reviewCount: 20, ratingSum: 60 },
      head: { aggregateRevision: 20, terminalAnalysisSequence: 40 },
      settlementCount: 20,
    })
  })

  it('keeps the latest analysis when the same review settles out of order', async () => {
    await db
      .delete(aiPropertyDailyAspectAggregates)
      .where(eq(aiPropertyDailyAspectAggregates.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyDailyAggregates)
      .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateContributions)
      .where(eq(aiPropertyAggregateContributions.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
    const [baseOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
      .limit(1)
    if (!baseOperation) throw new Error('Missing aggregate supersession fixture')

    await db.insert(aiOperations).values([
      {
        ...baseOperation,
        id: LATEST_OPERATION_ID,
        idempotencyScope: `analysis:${LATEST_OPERATION_ID}`,
        idempotencyKey: LATEST_OPERATION_ID,
        originEventId: LATEST_EVENT_ID,
        analysisSequence: 9,
      },
      {
        ...baseOperation,
        id: SUPERSEDED_OPERATION_ID,
        idempotencyScope: `analysis:${SUPERSEDED_OPERATION_ID}`,
        idempotencyKey: SUPERSEDED_OPERATION_ID,
        originEventId: SUPERSEDED_EVENT_ID,
        analysisSequence: 5,
      },
    ])
    await db.insert(aiReviewAnalyses).values([
      {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 9,
        operationId: LATEST_OPERATION_ID,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v2',
        status: 'ready',
        unavailableReason: null,
        sentiment: 'positive',
        primaryCategory: 'service',
        issueLabel: null,
        attention: 'low',
        generatedAt: COMPLETED_AT,
        expiresAt: ANALYSIS_EXPIRES_AT,
      },
      {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 5,
        operationId: SUPERSEDED_OPERATION_ID,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v2',
        status: 'ready',
        unavailableReason: null,
        sentiment: 'negative',
        primaryCategory: 'quality',
        issueLabel: null,
        attention: 'urgent',
        generatedAt: COMPLETED_AT,
        expiresAt: ANALYSIS_EXPIRES_AT,
      },
    ])
    await db.insert(aiReviewAnalysisAspects).values([
      {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 9,
        aspect: 'service',
        polarity: 'positive',
        intensity: 75,
      },
      {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 5,
        aspect: 'quality',
        polarity: 'negative',
        intensity: -75,
      },
    ])

    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    await db
      .update(reviews)
      .set({ analysisSequence: 9 })
      .where(eq(reviews.id, REVIEW_A_ID))
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 9,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })

    const superseded = await aggregates.applyReviewAnalysis({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_A_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 5,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      calendarProfileVersion: 'property-calendar-v1',
    })

    const [daily] = await db
      .select({
        reviewCount: aiPropertyDailyAggregates.reviewCount,
        ratingSum: aiPropertyDailyAggregates.ratingSum,
        positiveCount: aiPropertyDailyAggregates.positiveCount,
        negativeCount: aiPropertyDailyAggregates.negativeCount,
        urgentCount: aiPropertyDailyAggregates.urgentCount,
        lowCount: aiPropertyDailyAggregates.lowCount,
      })
      .from(aiPropertyDailyAggregates)
      .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID))
    expect(daily).toEqual({
      reviewCount: 1,
      ratingSum: 5,
      positiveCount: 1,
      negativeCount: 0,
      urgentCount: 0,
      lowCount: 1,
    })
    expect(superseded).toEqual({ status: 'stale' })
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 9,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'replayed', aggregateRevision: 1 })
    await expect(
      aggregates.applyReviewAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 5,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'stale' })

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

  it('rejects an analysis after the review is pinned to a newer sequence', async () => {
    const allocated = await db.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${ORGANIZATION_ID},
        ${PROPERTY_ID}::uuid,
        ${SOURCE_EPOCH}
      ) AS sequence
    `)
    expect(Number(allocated.rows[0]?.sequence)).toBe(3)
    await db
      .update(reviews)
      .set({ analysisSequence: 3 })
      .where(eq(reviews.id, REVIEW_A_ID))

    await expect(storeReviewA()).resolves.toBe(false)
    const analyses = await db
      .select({ operationId: aiReviewAnalyses.operationId })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.operationId, OPERATION_ID))
    expect(analyses).toEqual([])
  })
})
