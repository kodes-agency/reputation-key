// A review analysis v3 through the real stores (migration 0078): the output store
// writes the analysis, its mentions and the sentence numbers each cites, and
// closes the operation with what the normalizer did; the aggregate store files the
// mentions under the contribution that retracts with them and leaves the v2 daily
// cube alone; the Inbox read returns the v3 shape. Every row is synthetic: ids,
// counters and invented topics, no review text of a guest.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiPropertyAggregateContributionMentions,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiPropertyIssueGroups,
  aiPropertyIssueMembers,
  aiPropertyDailyAggregates,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisMentions,
  aiReviewAnalysisMentionSentences,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from '#/shared/review-analysis-v3-normalizer'
import type { AiOperationId } from '../../domain/types'
import type { AiAnalysisDerivativeV3 } from '../../application/ports/ai-output-store.port'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'
import { urgentAlertEventId } from './ai-urgent-alert'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const COMPLETED_AT = new Date('2026-10-20T10:05:00.000Z')
const CONTENT_EXPIRES_AT = new Date('2026-11-20T10:00:00.000Z')
const ANALYSIS_EXPIRES_AT = new Date('2028-10-19T10:05:00.000Z')
const REVIEWED_AT = new Date('2026-10-19T10:00:00.000Z')

const ORGANIZATION_ID = organizationId('ai-v3-flow-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '76000000-0000-4000-8000-000000000002'
const REVIEW_ID = reviewId('76000000-0000-4000-8000-000000000003')
const OPERATION_ID = '76000000-0000-4000-8000-000000000005' as AiOperationId
const SECOND_OPERATION_ID = '76000000-0000-4000-8000-000000000006' as AiOperationId
const THIRD_OPERATION_ID = '76000000-0000-4000-8000-000000000007' as AiOperationId
const SECOND_REVIEW_ID = reviewId('76000000-0000-4000-8000-000000000008')
const ACTOR_USER_ID = 'ai-v3-flow-test-actor'
const SOURCE_EPOCH = 0
const SOURCE_REVISION = 1
const DIGEST = 'a'.repeat(64)
const SOURCE_BYTE_COUNT = 24

const CONTROL_SCOPE_KEYS = [
  'global',
  `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
  'capability:review_analysis',
] as const

const DERIVATIVE: AiAnalysisDerivativeV3 = {
  sentiment: 'mixed',
  attention: 'high',
  urgentReason: null,
  mentions: [
    {
      topic: 'speed_waiting',
      polarity: 'negative',
      strength: 'clear',
      thing: 'check-in',
      issue: 'slow',
      sentences: [2, 3],
      namesPerson: null,
    },
    {
      topic: 'facilities_equipment',
      polarity: 'positive',
      strength: 'mild',
      thing: null,
      issue: null,
      sentences: [1],
      namesPerson: 'team_member',
    },
  ],
  normalization: { flags: ['mentions_merged'], droppedMentionCount: 1 },
}

describe.sequential('review analysis v3 through the real stores (PostgreSQL)', () => {
  const db: Database = getDb()
  const outputs = createAiOutputStoreAdapter(db)
  const aggregates = createAiPropertyAggregateStoreAdapter(db)
  let initialControls: ReadonlyArray<{
    scopeKey: string
    executionState: 'enabled' | 'killed'
    admissionState: 'accepting' | 'draining'
  }> = []

  const clear = async () => {
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  async function transitionControl(
    scopeKey: string,
    posture: Readonly<{
      executionState: 'enabled' | 'killed'
      admissionState: 'accepting' | 'draining'
    }>,
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
        ticketReference: `ai-v3-flow-test-${scopeKey}-${generation}`,
        candidateReleaseSha: null,
        occurredAt,
      })
      await tx
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
    })
  }

  /** One review, its revision, and the operation that is analysing it (v3 lineage). */
  async function seedReviewWithOperation(
    id: string,
    operationId: string,
    analysisSequence: number,
    options: Readonly<{
      profile?: 'review-analysis-v2' | 'review-analysis-v3'
      reviewAnalysisEpoch?: number
      sourceRevision?: number
    }> = {},
  ): Promise<void> {
    const heads = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
      .where(inArray(aiExecutionControlHeads.scopeKey, [...CONTROL_SCOPE_KEYS]))
    const control = (key: string) => {
      const found = heads.find((head) => head.scopeKey === key)
      if (!found) throw new Error(`AI execution control ${key} is not seeded`)
      return found
    }
    const global = control(CONTROL_SCOPE_KEYS[0])
    const provider = control(CONTROL_SCOPE_KEYS[1])
    const capability = control(CONTROL_SCOPE_KEYS[2])
    const v3 = (options.profile ?? 'review-analysis-v3') === 'review-analysis-v3'
    const reviewAnalysisEpoch = options.reviewAnalysisEpoch ?? 1
    const sourceRevision = options.sourceRevision ?? SOURCE_REVISION
    await db
      .insert(reviews)
      .values({
        id,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: `ai-v3-flow-${id}`,
        reviewerName: 'Synthetic reviewer',
        rating: 2,
        text: 'Synthetic review',
        languageCode: 'en',
        reviewedAt: REVIEWED_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision,
        analysisSequence,
        aiSourceByteLength: SOURCE_BYTE_COUNT,
        aiSourceDigest: DIGEST,
      })
      .onConflictDoUpdate({
        target: reviews.id,
        set: { analysisSequence, sourceRevision },
      })
    await db
      .insert(materialReviewRevisions)
      .values({
        reviewId: id,
        revision: sourceRevision,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        normalizationVersion: 'legacy-unverified-v0',
        rating: 2,
        normalizedText: 'Synthetic review',
      })
      .onConflictDoNothing()
    await db.insert(aiOperations).values({
      id: operationId,
      idempotencyScope: `analysis:${operationId}`,
      idempotencyKey: operationId,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: DIGEST,
      sourceByteCount: SOURCE_BYTE_COUNT,
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: id,
      originEventId: randomUUID(),
      subjectHmac: 'd'.repeat(64),
      subjectHmacKeyVersion: 'ai-v3-flow-test-v1',
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision,
      reviewedAtEpochMillis: REVIEWED_AT.getTime(),
      analysisSequence,
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      evaluatedLanguage: 'en',
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      operationProfileVersion: v3 ? 'review-analysis-v3' : 'review-analysis-v2',
      capabilityRuntimeProfileVersion: v3
        ? 'review-analysis-runtime-v2'
        : 'review-analysis-runtime-v1',
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'e'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      globalControlId: global.controlId,
      globalControlGeneration: global.generation,
      providerControlId: provider.controlId,
      providerControlGeneration: provider.generation,
      capabilityControlId: capability.controlId,
      capabilityControlGeneration: capability.generation,
      capabilityFences: { capability: 'review_analysis', reviewAnalysisEpoch },
      routeKey: 'review-analysis',
      state: 'executing',
      executionAttempt: 1,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date('2026-10-21T10:00:00.000Z'),
      ...(v3
        ? {
            providerId: 'openai',
            providerModel: 'synthetic-model-2026-10-01',
            providerRequestProfileVersion: 'synthetic-request-profile-v1',
            providerRequestProfileDigest: '1'.repeat(64),
            vocabularyHintSetId: 'generic-service',
            vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
            vocabularyHintSetDigest: '2'.repeat(64),
            normalizationProfileVersion: 'review-analysis-normalization-v1',
            normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
          }
        : {}),
    })
  }

  const store = (
    overrides: Partial<Parameters<typeof outputs.storeAnalysisV3>[0]> = {},
  ) =>
    outputs.storeAnalysisV3({
      operationId: OPERATION_ID,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: 'synthetic-model-2026-10-01',
        inputTokens: 300,
        outputTokens: 80,
        completedAtEpochMillis: COMPLETED_AT.getTime(),
      },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      analysisProfileVersion: 'review-analysis-v3',
      derivative: DERIVATIVE,
      generatedAtEpochMillis: COMPLETED_AT.getTime(),
      expiresAtEpochMillis: ANALYSIS_EXPIRES_AT.getTime(),
      ...overrides,
    })

  const apply = (analysisSequence: number) =>
    aggregates.applyReviewAnalysis({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      calendarProfileVersion: 'property-calendar-v1',
    })

  const read = (analysisSequence = 1) =>
    outputs.readAnalysisForDelivery(
      {
        organizationId: ORGANIZATION_ID,
        actorUserId: userId(ACTOR_USER_ID),
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v3',
        nowEpochMillis: COMPLETED_AT.getTime(),
      },
      async (result) => result,
    )

  beforeAll(async () => {
    // An Urgent analysis writes an identifier-only fact to the outbox, which admits only
    // registered facts; the app registers them at boot.
    registerAllEventSchemas()
    await clear()
    initialControls = (
      await db
        .select({
          scopeKey: aiExecutionControlHeads.scopeKey,
          executionState: aiExecutionControlHeads.executionState,
          admissionState: aiExecutionControlHeads.admissionState,
        })
        .from(aiExecutionControlHeads)
        .where(inArray(aiExecutionControlHeads.scopeKey, [...CONTROL_SCOPE_KEYS]))
    ).map((head) => ({
      scopeKey: head.scopeKey,
      executionState: head.executionState as 'enabled' | 'killed',
      admissionState: head.admissionState as 'accepting' | 'draining',
    }))
    for (const scopeKey of CONTROL_SCOPE_KEYS) {
      await transitionControl(scopeKey, {
        executionState: 'enabled',
        admissionState: 'accepting',
      })
    }
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI v3 flow test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI v3 flow test property',
      slug: 'ai-v3-flow-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: 4,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const authorization = {
      capabilities: ['review_analysis'],
      capabilityRuntimeProfileVersions: { review_analysis: 'review-analysis-runtime-v2' },
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
    } as const
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        ...authorization,
        capabilities: ['review_analysis'],
        actorUserId: ACTOR_USER_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-v3-flow-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        stateVersion: 1,
        ...authorization,
        capabilities: ['review_analysis'],
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
  })

  beforeEach(async () => {
    await db.delete(aiReviewAnalyses).where(eq(aiReviewAnalyses.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateContributions)
      .where(eq(aiPropertyAggregateContributions.propertyId, PROPERTY_ID))
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
      .delete(aiPropertyIssueGroups)
      .where(eq(aiPropertyIssueGroups.propertyId, PROPERTY_ID))
    await db.delete(reviews).where(eq(reviews.organizationId, ORGANIZATION_ID))
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, ORGANIZATION_ID))
    await seedReviewWithOperation(REVIEW_ID, OPERATION_ID, 1)
  })

  afterAll(async () => {
    try {
      await clear()
    } finally {
      clearEventSchemas()
      for (const control of initialControls) {
        await transitionControl(control.scopeKey, control)
      }
    }
  })

  it('stores the analysis root, the mentions in answer order, the sentences each cites, and closes the operation with the normalizer record', async () => {
    await expect(store()).resolves.toBe(true)

    const [root] = await db
      .select({
        analysisProfileVersion: aiReviewAnalyses.analysisProfileVersion,
        status: aiReviewAnalyses.status,
        sentiment: aiReviewAnalyses.sentiment,
        attention: aiReviewAnalyses.attention,
        primaryCategory: aiReviewAnalyses.primaryCategory,
        issueLabel: aiReviewAnalyses.issueLabel,
        urgentReason: aiReviewAnalyses.urgentReason,
        expiresAt: aiReviewAnalyses.expiresAt,
      })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_ID))
    expect(root).toEqual({
      analysisProfileVersion: 'review-analysis-v3',
      status: 'ready',
      sentiment: 'mixed',
      attention: 'high',
      primaryCategory: null,
      issueLabel: null,
      urgentReason: null,
      expiresAt: ANALYSIS_EXPIRES_AT,
    })
    const mentions = await db
      .select({
        ordinal: aiReviewAnalysisMentions.mentionOrdinal,
        topic: aiReviewAnalysisMentions.topic,
        polarity: aiReviewAnalysisMentions.polarity,
        strength: aiReviewAnalysisMentions.strength,
        thing: aiReviewAnalysisMentions.thing,
        issue: aiReviewAnalysisMentions.issue,
        namesPerson: aiReviewAnalysisMentions.namesPerson,
      })
      .from(aiReviewAnalysisMentions)
      .where(eq(aiReviewAnalysisMentions.reviewId, REVIEW_ID))
      .orderBy(aiReviewAnalysisMentions.mentionOrdinal)
    expect(mentions).toEqual([
      {
        ordinal: 0,
        topic: 'speed_waiting',
        polarity: 'negative',
        strength: 'clear',
        thing: 'check-in',
        issue: 'slow',
        namesPerson: null,
      },
      {
        ordinal: 1,
        topic: 'facilities_equipment',
        polarity: 'positive',
        strength: 'mild',
        thing: null,
        issue: null,
        namesPerson: 'team_member',
      },
    ])
    const sentences = await db
      .select({
        ordinal: aiReviewAnalysisMentionSentences.mentionOrdinal,
        sentence: aiReviewAnalysisMentionSentences.sentenceNumber,
      })
      .from(aiReviewAnalysisMentionSentences)
      .where(eq(aiReviewAnalysisMentionSentences.reviewId, REVIEW_ID))
      .orderBy(
        aiReviewAnalysisMentionSentences.mentionOrdinal,
        aiReviewAnalysisMentionSentences.sentenceNumber,
      )
    expect(sentences).toEqual([
      { ordinal: 0, sentence: 2 },
      { ordinal: 0, sentence: 3 },
      { ordinal: 1, sentence: 1 },
    ])
    const [operation] = await db
      .select({
        state: aiOperations.state,
        updatedAt: aiOperations.updatedAt,
        flags: aiOperations.normalizationFlags,
        dropped: aiOperations.droppedMentionCount,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
    expect(operation).toEqual({
      state: 'succeeded_pending_delivery',
      updatedAt: COMPLETED_AT,
      flags: ['mentions_merged'],
      dropped: 1,
    })
  })

  it('stores an analysis with an Urgent reason and no mentions', async () => {
    await expect(
      store({
        derivative: {
          sentiment: 'negative',
          attention: 'urgent',
          urgentReason: 'health',
          mentions: [],
          normalization: { flags: [], droppedMentionCount: 0 },
        },
      }),
    ).resolves.toBe(true)

    const [root] = await db
      .select({
        attention: aiReviewAnalyses.attention,
        reason: aiReviewAnalyses.urgentReason,
      })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_ID))
    expect(root).toEqual({ attention: 'urgent', reason: 'health' })
    await expect(
      db
        .select({ ordinal: aiReviewAnalysisMentions.mentionOrdinal })
        .from(aiReviewAnalysisMentions)
        .where(eq(aiReviewAnalysisMentions.reviewId, REVIEW_ID)),
    ).resolves.toEqual([])
  })

  it('writes nothing, and leaves the operation executing, when a fence does not hold', async () => {
    const refusals = [
      { analysisProfileVersion: 'review-analysis-v2' },
      { analysisSequence: 2 },
      {
        providerCompletion: {
          expectedAttempt: 2,
          modelSnapshot: 'synthetic-model-2026-10-01',
          inputTokens: 1,
          outputTokens: 1,
          completedAtEpochMillis: COMPLETED_AT.getTime(),
        },
      },
      { authorizationLineageId: '76000000-0000-4000-8000-0000000000ff' },
      { sourceRevision: 2 },
    ]
    for (const refusal of refusals) await expect(store(refusal)).resolves.toBe(false)

    await expect(
      db.select().from(aiReviewAnalyses).where(eq(aiReviewAnalyses.reviewId, REVIEW_ID)),
    ).resolves.toEqual([])
    const [operation] = await db
      .select({ state: aiOperations.state })
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
    expect(operation?.state).toBe('executing')
  })

  it('refuses a v3 analysis under an operation of another profile', async () => {
    await db.delete(aiOperations).where(eq(aiOperations.id, OPERATION_ID))
    await db.delete(reviews).where(eq(reviews.id, REVIEW_ID))
    await seedReviewWithOperation(REVIEW_ID, OPERATION_ID, 1, {
      profile: 'review-analysis-v2',
    })

    await expect(store()).resolves.toBe(false)

    await expect(
      db.select().from(aiReviewAnalyses).where(eq(aiReviewAnalyses.reviewId, REVIEW_ID)),
    ).resolves.toEqual([])
  })

  it('answers false for a second write of the same analysis', async () => {
    await expect(store()).resolves.toBe(true)
    await db
      .update(aiOperations)
      .set({ state: 'executing' })
      .where(eq(aiOperations.id, OPERATION_ID))

    await expect(store()).resolves.toBe(false)
  })

  describe('the Urgent alert fact', () => {
    const URGENT: AiAnalysisDerivativeV3 = {
      sentiment: 'negative',
      attention: 'urgent',
      urgentReason: 'health',
      mentions: [],
      normalization: { flags: [], droppedMentionCount: 0 },
    }

    const alerts = () =>
      db
        .select({
          id: outboxEvents.id,
          eventType: outboxEvents.eventType,
          propertyId: outboxEvents.propertyId,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, ORGANIZATION_ID),
            eq(outboxEvents.eventType, 'ai.review_analysis.urgent_detected'),
          ),
        )

    beforeEach(async () => {
      await db
        .delete(outboxEvents)
        .where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
    })

    it('records one identifier-only fact for an Urgent analysis, with no reason in it', async () => {
      await expect(store({ derivative: URGENT })).resolves.toBe(true)

      const found = await alerts()
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({
        id: urgentAlertEventId({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          reviewId: REVIEW_ID,
          sourceEpoch: SOURCE_EPOCH,
          sourceRevision: SOURCE_REVISION,
        }),
        propertyId: PROPERTY_ID,
        payload: {
          reviewId: REVIEW_ID,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          sourceEpoch: SOURCE_EPOCH,
          sourceRevision: SOURCE_REVISION,
          analysisSequence: 1,
          occurredAt: COMPLETED_AT.toISOString(),
          correlationId: OPERATION_ID,
        },
      })
      // The fact says which revision and nothing of why: the reason is read in the app.
      expect(JSON.stringify(found[0]?.payload)).not.toContain('health')
      expect(Object.keys(found[0]?.payload as object).sort()).toEqual([
        'analysisSequence',
        'correlationId',
        'occurredAt',
        'organizationId',
        'propertyId',
        'reviewId',
        'sourceEpoch',
        'sourceRevision',
      ])
    })

    it('records nothing for an analysis that is not Urgent', async () => {
      await expect(store()).resolves.toBe(true)

      await expect(alerts()).resolves.toEqual([])
    })

    it('records nothing when the analysis is refused', async () => {
      await expect(store({ derivative: URGENT, analysisSequence: 2 })).resolves.toBe(
        false,
      )

      await expect(alerts()).resolves.toEqual([])
    })

    it('raises one alert for a review revision however often it is found Urgent', async () => {
      await store({ derivative: URGENT })
      // The same revision analysed again: a re-consent's new epoch, a reopen, a replay.
      await seedReviewWithOperation(REVIEW_ID, SECOND_OPERATION_ID, 2)
      await expect(
        store({
          operationId: SECOND_OPERATION_ID,
          analysisSequence: 2,
          derivative: URGENT,
        }),
      ).resolves.toBe(true)

      await expect(alerts()).resolves.toHaveLength(1)
    })

    it('does not raise it again when the first fact has left the outbox', async () => {
      await store({ derivative: URGENT })
      // The retention sweep deletes a published fact 30 days after publication; the
      // analyses live for 24 months and remember that the revision was Urgent.
      await db
        .delete(outboxEvents)
        .where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
      await seedReviewWithOperation(REVIEW_ID, SECOND_OPERATION_ID, 2)
      await store({
        operationId: SECOND_OPERATION_ID,
        analysisSequence: 2,
        derivative: URGENT,
      })

      await expect(alerts()).resolves.toEqual([])
    })

    it('raises a second alert when the guest changes the review', async () => {
      await store({ derivative: URGENT })
      await seedReviewWithOperation(REVIEW_ID, SECOND_OPERATION_ID, 2, {
        sourceRevision: 2,
      })
      await expect(
        store({
          operationId: SECOND_OPERATION_ID,
          analysisSequence: 2,
          sourceRevision: 2,
          derivative: URGENT,
        }),
      ).resolves.toBe(true)

      const found = await alerts()
      expect(
        found
          .map(({ payload }) => (payload as { sourceRevision: number }).sourceRevision)
          .sort(),
      ).toEqual([1, 2])
    })

    it('raises one alert for each review', async () => {
      await store({ derivative: URGENT })
      await seedReviewWithOperation(SECOND_REVIEW_ID, SECOND_OPERATION_ID, 2)
      await store({
        operationId: SECOND_OPERATION_ID,
        reviewId: SECOND_REVIEW_ID,
        analysisSequence: 2,
        derivative: URGENT,
      })

      await expect(alerts()).resolves.toHaveLength(2)
    })
  })

  it('reads the stored analysis back as the v3 shape', async () => {
    await store()

    await expect(read()).resolves.toEqual({
      status: 'ready_v3',
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 1,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      analysisProfileVersion: 'review-analysis-v3',
      sentiment: 'mixed',
      attention: 'high',
      urgentReason: null,
      // The answer's own fields, each with its place in the answer, and (before the
      // aggregate has filed it under an issue, and with no manager's word) neither.
      mentions: DERIVATIVE.mentions.map((mention, mentionOrdinal) => ({
        ...mention,
        mentionOrdinal,
        issueGroupId: null,
        correction: null,
      })),
      generatedAtEpochMillis: COMPLETED_AT.getTime(),
    })
  })

  it('files the mentions under the contribution, counts the sequence, and never writes the v2 daily cube', async () => {
    await store()

    await expect(apply(1)).resolves.toEqual({ status: 'applied', aggregateRevision: 1 })

    const [contribution] = await db
      .select({
        status: aiPropertyAggregateContributions.status,
        sentiment: aiPropertyAggregateContributions.sentiment,
        primaryCategory: aiPropertyAggregateContributions.primaryCategory,
        attention: aiPropertyAggregateContributions.attention,
        localDate: aiPropertyAggregateContributions.localDate,
        rating: aiPropertyAggregateContributions.rating,
      })
      .from(aiPropertyAggregateContributions)
      .where(eq(aiPropertyAggregateContributions.reviewId, REVIEW_ID))
    expect(contribution).toEqual({
      status: 'ready',
      sentiment: 'mixed',
      primaryCategory: null,
      attention: 'high',
      localDate: '2026-10-19',
      rating: 2,
    })
    const mentions = await db
      .select({
        ordinal: aiPropertyAggregateContributionMentions.mentionOrdinal,
        topic: aiPropertyAggregateContributionMentions.topic,
        strength: aiPropertyAggregateContributionMentions.strength,
        thing: aiPropertyAggregateContributionMentions.thing,
      })
      .from(aiPropertyAggregateContributionMentions)
      .where(eq(aiPropertyAggregateContributionMentions.reviewId, REVIEW_ID))
      .orderBy(aiPropertyAggregateContributionMentions.mentionOrdinal)
    expect(mentions).toEqual([
      { ordinal: 0, topic: 'speed_waiting', strength: 'clear', thing: 'check-in' },
      { ordinal: 1, topic: 'facilities_equipment', strength: 'mild', thing: null },
    ])
    await expect(
      db
        .select()
        .from(aiPropertyDailyAggregates)
        .where(eq(aiPropertyDailyAggregates.propertyId, PROPERTY_ID)),
    ).resolves.toEqual([])
  })

  it('replays an applied sequence without writing it twice', async () => {
    await store()
    await apply(1)

    await expect(apply(1)).resolves.toEqual({ status: 'replayed', aggregateRevision: 1 })

    await expect(
      db
        .select({ ordinal: aiPropertyAggregateContributionMentions.mentionOrdinal })
        .from(aiPropertyAggregateContributionMentions)
        .where(eq(aiPropertyAggregateContributionMentions.reviewId, REVIEW_ID)),
    ).resolves.toHaveLength(2)
  })

  it('keeps one stable issue id across reviews, spellings and a newer analysis', async () => {
    const derivative = (thing: string): AiAnalysisDerivativeV3 => ({
      sentiment: 'negative',
      attention: 'high',
      urgentReason: null,
      mentions: [
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'clear',
          thing,
          issue: 'noisy',
          sentences: [1],
          namesPerson: null,
        },
      ],
      normalization: { flags: [], droppedMentionCount: 0 },
    })
    await store({ derivative: derivative('ac') })
    await apply(1)
    await seedReviewWithOperation(SECOND_REVIEW_ID, SECOND_OPERATION_ID, 2)
    await store({
      operationId: SECOND_OPERATION_ID,
      reviewId: SECOND_REVIEW_ID,
      analysisSequence: 2,
      derivative: derivative('air con'),
    })
    await aggregates.applyReviewAnalysis({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: SECOND_REVIEW_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 2,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      calendarProfileVersion: 'property-calendar-v1',
    })

    const firstAssignments = await db
      .select({ issueGroupId: aiPropertyAggregateContributionMentions.issueGroupId })
      .from(aiPropertyAggregateContributionMentions)
      .where(
        inArray(aiPropertyAggregateContributionMentions.reviewId, [
          REVIEW_ID,
          SECOND_REVIEW_ID,
        ]),
      )
    expect(new Set(firstAssignments.map(({ issueGroupId }) => issueGroupId)).size).toBe(1)
    const stableId = firstAssignments[0]?.issueGroupId
    expect(stableId).toBeTypeOf('string')

    // A newer analysis of the first review, in the canonical spelling.
    await db.update(reviews).set({ analysisSequence: 3 }).where(eq(reviews.id, REVIEW_ID))
    await seedReviewWithOperation(REVIEW_ID, THIRD_OPERATION_ID, 3)
    await store({
      operationId: THIRD_OPERATION_ID,
      analysisSequence: 3,
      derivative: derivative('air conditioning'),
    })
    const newer = {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 3,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      calendarProfileVersion: 'property-calendar-v1' as const,
    }
    await aggregates.applyReviewAnalysis(newer)
    await expect(aggregates.applyReviewAnalysis(newer)).resolves.toMatchObject({
      status: 'replayed',
    })

    const groups = await db
      .select({
        id: aiPropertyIssueGroups.id,
        canonicalThing: aiPropertyIssueGroups.canonicalThing,
        canonicalKey: aiPropertyIssueGroups.canonicalKey,
        displayName: aiPropertyIssueGroups.displayName,
      })
      .from(aiPropertyIssueGroups)
      .where(eq(aiPropertyIssueGroups.propertyId, PROPERTY_ID))
    const members = await db
      .select({ memberThing: aiPropertyIssueMembers.memberThing })
      .from(aiPropertyIssueMembers)
      .where(eq(aiPropertyIssueMembers.propertyId, PROPERTY_ID))
    expect(groups).toEqual([
      {
        id: stableId,
        canonicalThing: 'air conditioning',
        canonicalKey: 'air conditioning',
        displayName: null,
      },
    ])
    expect(members.map(({ memberThing }) => memberThing).sort()).toEqual([
      'ac',
      'air con',
      'air conditioning',
    ])
  })

  it('takes a v3 contribution off when a newer sequence of the review settles without an analysis', async () => {
    await store()
    await apply(1)
    await db.update(reviews).set({ analysisSequence: 3 }).where(eq(reviews.id, REVIEW_ID))

    await expect(
      aggregates.advanceWithoutAnalysis({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        sourceEpoch: SOURCE_EPOCH,
        reviewAnalysisEpoch: 1,
        analysisSequence: 3,
        propertyProfileVersion: 1,
        dispositionCode: 'provider_deleted',
      }),
    ).resolves.toEqual({ status: 'applied', aggregateRevision: 2 })

    await expect(
      db
        .select()
        .from(aiPropertyAggregateContributions)
        .where(eq(aiPropertyAggregateContributions.reviewId, REVIEW_ID)),
    ).resolves.toEqual([])
    await expect(
      db
        .select()
        .from(aiPropertyAggregateContributionMentions)
        .where(eq(aiPropertyAggregateContributionMentions.reviewId, REVIEW_ID)),
    ).resolves.toEqual([])
  })

  it('keeps one effective contribution per review when a newer sequence is analysed', async () => {
    await store()
    await apply(1)
    await db.update(reviews).set({ analysisSequence: 2 }).where(eq(reviews.id, REVIEW_ID))
    await seedReviewWithOperation(REVIEW_ID, SECOND_OPERATION_ID, 2)
    const [firstMention] = DERIVATIVE.mentions
    if (firstMention === undefined) throw new Error('the derivative has a mention')
    await expect(
      store({
        operationId: SECOND_OPERATION_ID,
        analysisSequence: 2,
        derivative: { ...DERIVATIVE, mentions: [firstMention] },
      }),
    ).resolves.toBe(true)

    await expect(apply(2)).resolves.toEqual({ status: 'applied', aggregateRevision: 2 })

    const rows = await db
      .select({
        sequence: aiPropertyAggregateContributionMentions.analysisSequence,
        ordinal: aiPropertyAggregateContributionMentions.mentionOrdinal,
      })
      .from(aiPropertyAggregateContributionMentions)
      .where(eq(aiPropertyAggregateContributionMentions.reviewId, REVIEW_ID))
      .orderBy(
        aiPropertyAggregateContributionMentions.analysisSequence,
        aiPropertyAggregateContributionMentions.mentionOrdinal,
      )
    expect(rows).toEqual([
      { sequence: 1, ordinal: 0 },
      { sequence: 1, ordinal: 1 },
      { sequence: 2, ordinal: 0 },
    ])
  })

  it('keeps v3 analyses out of the legacy window, whose readers only know v2', async () => {
    await store()
    await apply(1)

    const window = await aggregates.readWindow({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      startLocalDate: '2026-10-19',
      endLocalDate: '2026-10-19',
    })

    expect(window?.analyzedReviews).toEqual([])
    expect(window?.days).toEqual([])
    expect(window?.coverage.settledAnalysisCount).toBe(1)
  })
})
