// Integration-test support: a Property with Review Analysis enabled and reviews that carry a
// v3 analysis, written through the real output and aggregate stores so the rows are the ones
// production writes. Every value is invented: ids, counters and topics, no guest's words.
//
// A test builds a seed for its own Organization and Property, calls `setUp()` once, adds
// reviews, and `seal()`s the head so the analysis reads as complete. `tearDown()` removes
// the rows and puts the shared execution controls back as it found them.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiPropertyDailyAggregates,
  aiPropertyIssueGroups,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deleteTestOrganizationsWithExecutor } from '#/shared/db/testing/test-organization-cleanup'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from '#/shared/review-analysis-v3-normalizer'
import type {
  ReviewAttentionLevelV2,
  ReviewSentimentV3,
  ReviewUrgentReasonV3,
} from '#/shared/review-analysis-v3'
import type { AiOperationId, ReviewAnalysisMentionV3 } from '../../domain/types'
import { createAiOutputStoreAdapter } from '../adapters/ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from '../adapters/ai-property-aggregate-store.adapter'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const COMPLETED_AT = new Date('2026-10-20T10:05:00.000Z')
const CONTENT_EXPIRES_AT = new Date('2030-01-01T00:00:00.000Z')
const ANALYSIS_EXPIRES_AT = new Date('2030-01-01T00:00:00.000Z')
const SOURCE_EPOCH = 0
const SOURCE_REVISION = 1
const REVIEW_ANALYSIS_EPOCH = 1
const PROPERTY_PROFILE_VERSION = 1
const DIGEST = 'a'.repeat(64)
const SOURCE_BYTE_COUNT = 24
const ACTOR_USER_ID = 'ai-v3-seed-actor'
const TIMEZONE = 'America/New_York'

const CONTROL_SCOPE_KEYS = [
  'global',
  `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
  'capability:review_analysis',
] as const

export type SeededIds = Readonly<{
  organizationId: string
  propertyId: string
  /** A prefix of a UUID's first group: ids made for reviews and operations start with it. */
  idPrefix: string
}>

/** One review to seed, with the analysis the store holds for it. */
export type SeededReview = Readonly<{
  /** 1-based; also the review's analysis sequence at the Property. */
  index: number
  rating: 1 | 2 | 3 | 4 | 5
  /** The instant the review was left; its Property-local day follows the Property's timezone. */
  reviewedAt: Date
  sentiment?: ReviewSentimentV3
  attention?: ReviewAttentionLevelV2
  urgentReason?: ReviewUrgentReasonV3 | null
  mentions?: readonly ReviewAnalysisMentionV3[]
}>

export function seededReviewId(ids: SeededIds, index: number): string {
  return `${ids.idPrefix}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function seededOperationId(ids: SeededIds, index: number): AiOperationId {
  return `${ids.idPrefix}-0001-4000-8000-${String(index).padStart(12, '0')}` as AiOperationId
}

function lineageId(ids: SeededIds): string {
  return `${ids.idPrefix}-0002-4000-8000-000000000001`
}

/** A mention, filled in with the usual defaults. */
export function mentionOf(
  fields: Pick<ReviewAnalysisMentionV3, 'topic' | 'polarity'> &
    Partial<ReviewAnalysisMentionV3>,
): ReviewAnalysisMentionV3 {
  return {
    strength: 'clear',
    thing: null,
    issue: null,
    sentences: [1],
    namesPerson: null,
    ...fields,
  }
}

export function createV3Seed(db: Database, ids: SeededIds) {
  const outputs = createAiOutputStoreAdapter(db)
  const aggregates = createAiPropertyAggregateStoreAdapter(db)
  let initialControls: ReadonlyArray<{
    scopeKey: string
    executionState: 'enabled' | 'killed'
    admissionState: 'accepting' | 'draining'
  }> = []
  let lastIndex = 0

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
        ticketReference: `ai-v3-seed-${scopeKey}-${generation}`,
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

  async function clear(): Promise<void> {
    await db.delete(properties).where(eq(properties.id, ids.propertyId))
    await deleteTestOrganizationsWithExecutor(db, [ids.organizationId])
  }

  async function seedAuthorization(): Promise<void> {
    const authorization = {
      capabilities: ['review_analysis'],
      capabilityRuntimeProfileVersions: { review_analysis: 'review-analysis-runtime-v1' },
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
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
        organizationId: ids.organizationId,
        propertyId: ids.propertyId,
        authorizationLineageId: lineageId(ids),
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        ...authorization,
        capabilities: ['review_analysis'],
        actorUserId: ACTOR_USER_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: `ai-v3-seed-enable-${ids.idPrefix}`,
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: ids.propertyId,
        organizationId: ids.organizationId,
        authorizationLineageId: lineageId(ids),
        state: 'enabled',
        stateVersion: 1,
        ...authorization,
        capabilities: ['review_analysis'],
        updatedBy: ACTOR_USER_ID,
        updatedAt: NOW,
      })
    })
  }

  async function insertOperation(index: number, reviewedAt: Date): Promise<void> {
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
    const operationId = seededOperationId(ids, index)
    await db.insert(aiOperations).values({
      id: operationId,
      idempotencyScope: `analysis:${operationId}`,
      idempotencyKey: operationId,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: DIGEST,
      sourceByteCount: SOURCE_BYTE_COUNT,
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: ids.organizationId,
      propertyId: ids.propertyId,
      actorUserId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: seededReviewId(ids, index),
      originEventId: randomUUID(),
      subjectHmac: 'd'.repeat(64),
      subjectHmacKeyVersion: 'ai-v3-seed-v1',
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      reviewedAtEpochMillis: reviewedAt.getTime(),
      analysisSequence: index,
      authorizationLineageId: lineageId(ids),
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      evaluatedLanguage: 'en',
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      operationProfileVersion: 'review-analysis-v3',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'e'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      globalControlId: global.controlId,
      globalControlGeneration: global.generation,
      providerControlId: provider.controlId,
      providerControlGeneration: provider.generation,
      capabilityControlId: capability.controlId,
      capabilityControlGeneration: capability.generation,
      capabilityFences: {
        capability: 'review_analysis',
        reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      },
      routeKey: 'review-analysis',
      state: 'executing',
      executionAttempt: 1,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date('2026-10-21T10:00:00.000Z'),
      providerId: 'openai',
      providerModel: 'synthetic-model-2026-10-01',
      providerRequestProfileVersion: 'synthetic-request-profile-v1',
      providerRequestProfileDigest: '1'.repeat(64),
      vocabularyHintSetId: 'generic-service',
      vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
      vocabularyHintSetDigest: '2'.repeat(64),
      normalizationProfileVersion: 'review-analysis-normalization-v1',
      normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
    })
  }

  async function insertReview(review: SeededReview): Promise<void> {
    const id = seededReviewId(ids, review.index)
    await db.insert(reviews).values({
      id,
      organizationId: ids.organizationId,
      propertyId: ids.propertyId,
      platform: 'google',
      externalId: `ai-v3-seed-${id}`,
      reviewerName: 'Synthetic reviewer',
      rating: review.rating,
      text: 'Synthetic review',
      languageCode: 'en',
      reviewedAt: review.reviewedAt,
      contentExpiresAt: CONTENT_EXPIRES_AT,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: review.index,
      aiSourceByteLength: SOURCE_BYTE_COUNT,
      aiSourceDigest: DIGEST,
    })
    await db.insert(materialReviewRevisions).values({
      reviewId: id,
      revision: SOURCE_REVISION,
      organizationId: ids.organizationId,
      propertyId: ids.propertyId,
      sourceEpoch: SOURCE_EPOCH,
      normalizationVersion: 'legacy-unverified-v0',
      rating: review.rating,
      normalizedText: 'Synthetic review',
    })
  }

  async function storeAnalysis(review: SeededReview): Promise<void> {
    const write = {
      operationId: seededOperationId(ids, review.index),
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: 'synthetic-model-2026-10-01',
        inputTokens: 300,
        outputTokens: 80,
        completedAtEpochMillis: COMPLETED_AT.getTime(),
      },
      organizationId: organizationId(ids.organizationId),
      propertyId: propertyId(ids.propertyId),
      reviewId: reviewId(seededReviewId(ids, review.index)),
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: review.index,
      authorizationLineageId: lineageId(ids),
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      analysisProfileVersion: 'review-analysis-v3',
      generatedAtEpochMillis: COMPLETED_AT.getTime(),
      expiresAtEpochMillis: ANALYSIS_EXPIRES_AT.getTime(),
    }
    const stored = await outputs.storeAnalysisV3({
      ...write,
      derivative: {
        sentiment: review.sentiment ?? 'neutral',
        attention: review.attention ?? 'low',
        urgentReason: review.urgentReason ?? null,
        mentions: review.mentions ?? [],
        normalization: { flags: [], droppedMentionCount: 0 },
      },
    })
    if (!stored)
      throw new Error(`The seed could not store the analysis of review ${review.index}`)
    const applied = await aggregates.applyReviewAnalysis({
      organizationId: organizationId(ids.organizationId),
      propertyId: propertyId(ids.propertyId),
      reviewId: reviewId(seededReviewId(ids, review.index)),
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: review.index,
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      calendarProfileVersion: 'property-calendar-v1',
    })
    if (applied.status !== 'applied') {
      throw new Error(`The seed could not file review ${review.index}: ${applied.status}`)
    }
  }

  return {
    ids,
    outputs,
    aggregates,
    scope: {
      organizationId: organizationId(ids.organizationId),
      propertyId: propertyId(ids.propertyId),
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
    },

    async setUp(): Promise<void> {
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
        VALUES (${ids.organizationId}, 'AI v3 seed', ${ids.organizationId}, ${NOW})
      `)
      await db.insert(properties).values({
        id: ids.propertyId,
        organizationId: ids.organizationId,
        name: 'AI v3 seed property',
        slug: `ai-v3-seed-${ids.idPrefix}`,
        timezone: TIMEZONE,
        countryCode: 'US',
        profileVersion: PROPERTY_PROFILE_VERSION,
        sourceEpoch: SOURCE_EPOCH,
      })
      await db.insert(reviewAiAnalysisHeads).values({
        organizationId: ids.organizationId,
        propertyId: ids.propertyId,
        sourceEpoch: SOURCE_EPOCH,
        headSequence: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })
      await seedAuthorization()
      await db.insert(aiPropertyProcessingProfiles).values({
        propertyId: ids.propertyId,
        organizationId: ids.organizationId,
        countryCode: 'US',
        timezone: TIMEZONE,
        processingRegion: 'global',
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
        sourceEpoch: SOURCE_EPOCH,
        profileVersion: PROPERTY_PROFILE_VERSION,
        lifecycleState: 'active',
        updatedAt: NOW,
      })
    },

    /** Seeds one review and files its analysis. */
    async addReview(review: SeededReview): Promise<void> {
      lastIndex = Math.max(lastIndex, review.index)
      await insertReview(review)
      await insertOperation(review.index, review.reviewedAt)
      await storeAnalysis(review)
    },

    /** Lets the Property's analysis read as complete: its head is where the last review is. */
    async seal(headSequence = lastIndex): Promise<void> {
      await db
        .update(reviewAiAnalysisHeads)
        .set({ headSequence })
        .where(eq(reviewAiAnalysisHeads.propertyId, ids.propertyId))
    },

    /** Removes what the seed wrote and puts the execution controls back. */
    async tearDown(): Promise<void> {
      try {
        await db
          .delete(aiPropertyAggregateContributions)
          .where(eq(aiPropertyAggregateContributions.propertyId, ids.propertyId))
        await db
          .delete(aiReviewAnalyses)
          .where(eq(aiReviewAnalyses.propertyId, ids.propertyId))
        await db
          .delete(aiPropertyDailyAggregates)
          .where(eq(aiPropertyDailyAggregates.propertyId, ids.propertyId))
        await db
          .delete(aiPropertyAggregateHeads)
          .where(eq(aiPropertyAggregateHeads.propertyId, ids.propertyId))
        await db
          .delete(aiPropertyAggregateSettlements)
          .where(eq(aiPropertyAggregateSettlements.propertyId, ids.propertyId))
        await db
          .delete(aiPropertyIssueGroups)
          .where(eq(aiPropertyIssueGroups.propertyId, ids.propertyId))
        await db.delete(reviews).where(eq(reviews.organizationId, ids.organizationId))
        await db
          .delete(aiOperations)
          .where(eq(aiOperations.organizationId, ids.organizationId))
        await clear()
      } finally {
        for (const control of initialControls) {
          await transitionControl(control.scopeKey, control)
        }
      }
    },
  }
}
