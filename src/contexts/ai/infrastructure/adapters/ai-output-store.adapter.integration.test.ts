import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PRIMARY_CATEGORIES } from '#/shared/ai-primary-categories'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import type { AiOperationId } from '../../domain/types'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'

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
      operationProfileVersion: 'review-analysis-v1',
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
      analysisProfileVersion: 'review-analysis-v1',
      result: {
        status: 'ready',
        derivative: {
          sentiment: 'positive',
          primaryCategory: AI_PRIMARY_CATEGORIES[0],
          attention: 'low',
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
      })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.operationId, OPERATION_ID))
    expect(analysis).toEqual({
      reviewId: REVIEW_A_ID,
      analysisSequence: 1,
      status: 'ready',
      sentiment: 'positive',
      primaryCategory: AI_PRIMARY_CATEGORIES[0],
      attention: 'low',
    })

    const [operation] = await db
      .select({ state: aiOperations.state, updatedAt: aiOperations.updatedAt })
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
    expect(operation).toEqual({
      state: 'succeeded_pending_delivery',
      updatedAt: COMPLETED_AT,
    })
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
