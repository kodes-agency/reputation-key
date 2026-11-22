// Test fixture: one Organization and Property with an enabled Review Analysis
// authorization, two stable Reviews, an executing analysis operation and open
// execution controls. The AI output store suites share it; it is built once per
// suite and reset between tests.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiOperations,
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  outboxEvents,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { ASPECT_TAXONOMY_V1 } from '#/shared/analysis/aspect-taxonomy'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation/ai-operation-profiles'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from '#/shared/analysis/normalizer'
import { seedReviewContent } from './review-content.test-fixtures'
import type { AiOperationId } from '../domain/types'
import {
  requireControl,
  openAiExecutionControls,
} from '#/shared/db/testing/ai-execution-control-fixture'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'

export const NOW = new Date('2026-09-08T10:00:00.000Z')
export const COMPLETED_AT = new Date('2026-09-08T10:05:00.000Z')
export const CONTENT_EXPIRES_AT = new Date('2026-10-08T10:00:00.000Z')
export const ANALYSIS_EXPIRES_AT = new Date('2028-09-07T10:05:00.000Z')
export const OPERATION_EXPIRES_AT = new Date('2026-09-09T10:00:00.000Z')
export const REVIEWED_AT = new Date('2026-09-07T10:00:00.000Z')

export const ORGANIZATION_ID = organizationId('ai-output-store-test-org')
export const PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000001')
export const LINEAGE_ID = '75000000-0000-4000-8000-000000000002'
export const REVIEW_A_ID = reviewId('75000000-0000-4000-8000-000000000003')
export const REVIEW_B_ID = reviewId('75000000-0000-4000-8000-000000000004')
export const OPERATION_ID = '75000000-0000-4000-8000-000000000005' as AiOperationId
export const ORIGIN_EVENT_ID = '75000000-0000-4000-8000-000000000006'
export const ACTOR_USER_ID = 'ai-output-store-test-actor'
export const SOURCE_EPOCH = 0
export const SOURCE_REVISION = 1
export const REVIEW_A_SOURCE_DIGEST = 'a'.repeat(64)
export const SOURCE_BYTE_COUNT = 20

const REVIEW_B_SOURCE_DIGEST = 'b'.repeat(64)

type OperationRow = typeof aiOperations.$inferInsert
type AnalysisRow = typeof aiReviewAnalyses.$inferInsert
type OperationOverrides = Partial<OperationRow> & Readonly<{ id: AiOperationId }>
type AnalysisOverrides = Partial<AnalysisRow> &
  Readonly<{ reviewId: string; analysisSequence: number; operationId: string }>

export type ReviewAnalysisStoreOrigin = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
}>

export function createReviewAnalysisStoreFixture(db: Database) {
  let controls: Awaited<ReturnType<typeof openAiExecutionControls>> | undefined

  const remove = async () => {
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  }

  const install = async () => {
    await remove()
    controls = await openAiExecutionControls(db, {
      actorUserId: ACTOR_USER_ID,
      ticketPrefix: 'ai-output-store-test',
    })
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
    // Consent evidence may predate execution selection while the notice remains in force.
    await seedEnabledReviewAnalysis(db, {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationLineageId: LINEAGE_ID,
      analysisStartSequence: 0,
      authorizedSourceEpoch: SOURCE_EPOCH,
      occurredAt: NOW,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      actorUserId: ACTOR_USER_ID,
      reasonCode: 'merchant_enabled',
      idempotencyKey: 'ai-output-store-enable-v1',
      requestHash: 'c'.repeat(64),
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
    const reviewSeed = (
      id: typeof REVIEW_A_ID,
      letter: 'A' | 'B',
      rating: number,
      analysisSequence: number,
      aiSourceDigest: string,
    ) => ({
      id,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google' as const,
      externalId: `ai-output-store-review-${letter.toLowerCase()}`,
      reviewerName: `Synthetic reviewer ${letter}`,
      rating,
      text: `Synthetic review ${letter}`,
      languageCode: 'en',
      reviewedAt: REVIEWED_AT,
      contentExpiresAt: CONTENT_EXPIRES_AT,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence,
      aiSourceByteLength: SOURCE_BYTE_COUNT,
      aiSourceDigest,
      withMaterialRevision: true,
    })
    await seedReviewContent([
      reviewSeed(REVIEW_A_ID, 'A', 5, 1, REVIEW_A_SOURCE_DIGEST),
      reviewSeed(REVIEW_B_ID, 'B', 4, 2, REVIEW_B_SOURCE_DIGEST),
    ])

    const globalControl = requireControl(controls.heads, 'global')
    const providerControl = requireControl(
      controls.heads,
      `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
    )
    const capabilityControl = requireControl(controls.heads, 'capability:review_analysis')
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
      operationProfileVersion: 'review-analysis-v3',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
      // A v3 operation carries its provider and vocabulary lineage
      // (ai_operations_v3_lineage_required).
      providerId: 'openai',
      providerModel: 'synthetic-model-2026-10-01',
      providerRequestProfileVersion: 'synthetic-request-profile-v1',
      providerRequestProfileDigest: '1'.repeat(64),
      vocabularyHintSetId: 'generic-service',
      vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
      vocabularyHintSetDigest: '2'.repeat(64),
      normalizationProfileVersion: 'review-analysis-normalization-v1',
      normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
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
  }

  /** Back to the state `install` left, whatever the previous test wrote. */
  const resetBetweenTests = async () => {
    await db
      .delete(aiReviewAnalyses)
      .where(
        and(
          eq(aiReviewAnalyses.organizationId, ORGANIZATION_ID),
          eq(aiReviewAnalyses.propertyId, PROPERTY_ID),
        ),
      )
    await db
      .delete(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID))
    await db
      .delete(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID))
    await db
      .update(aiOperations)
      .set({
        state: 'executing',
        operationProfileVersion: 'review-analysis-v3',
        capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
        failureCode: null,
        nextAttemptAt: null,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        updatedAt: NOW,
      })
      .where(eq(aiOperations.id, OPERATION_ID))
    await db
      .update(reviews)
      .set({ analysisSequence: 1 })
      .where(eq(reviews.id, REVIEW_A_ID))
  }

  /** Drops the suite's rows and puts the execution controls back. */
  const dispose = async () => {
    try {
      await remove()
    } finally {
      await controls?.restore()
    }
  }

  /** The published fact an analysis operation came from; its receipts cascade. */
  const seedOriginEvent = (
    eventId: string,
    origin: ReviewAnalysisStoreOrigin = {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_A_ID,
    },
  ) =>
    db.insert(outboxEvents).values({
      id: eventId,
      eventType: 'review.updated',
      payload: {},
      organizationId: origin.organizationId,
      propertyId: origin.propertyId,
      sourceContext: 'review',
      sourceAggregateId: origin.reviewId,
      publishedAt: NOW,
    })

  const failOperation = (operationId: AiOperationId, failureCode = 'output_invalid') =>
    db
      .update(aiOperations)
      .set({ state: 'failed', failureCode, nextAttemptAt: null, updatedAt: COMPLETED_AT })
      .where(eq(aiOperations.id, operationId))

  /** Operations copied from the suite's executing one, each with its own identity. */
  const cloneOperations = async (rows: readonly OperationOverrides[]) => {
    const [baseOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
      .limit(1)
    if (!baseOperation) throw new Error('Missing review analysis store fixture operation')
    await db.insert(aiOperations).values(
      rows.map((row) => ({
        ...baseOperation,
        idempotencyScope: `analysis:${row.id}`,
        idempotencyKey: row.id,
        ...row,
      })),
    )
  }
  const cloneOperation = (row: OperationOverrides) => cloneOperations([row])

  /** Stored analyses; a row names its Review, sequence and operation, the rest is a ready v2 result. */
  const insertAnalyses = (rows: readonly AnalysisOverrides[]) =>
    db.insert(aiReviewAnalyses).values(
      rows.map((row) => ({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v2',
        status: 'ready' as const,
        unavailableReason: null,
        sentiment: 'positive' as const,
        primaryCategory: 'service',
        issueLabel: null,
        attention: 'low' as const,
        generatedAt: COMPLETED_AT,
        expiresAt: ANALYSIS_EXPIRES_AT,
        ...row,
      })),
    )

  /** Already-produced v2 output remains readable/aggregatable without admitting
   * its retired execution profile for a new settlement. */
  const seedStoredReviewA = async () => {
    await insertAnalyses([
      {
        reviewId: REVIEW_A_ID,
        analysisSequence: 1,
        operationId: OPERATION_ID,
        primaryCategory: ASPECT_TAXONOMY_V1[0],
        issueLabel: 'helpful service',
      },
    ])
    await db
      .update(aiOperations)
      .set({
        operationProfileVersion: 'review-analysis-v2',
        capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
        state: 'succeeded_pending_delivery',
        updatedAt: COMPLETED_AT,
      })
      .where(eq(aiOperations.id, OPERATION_ID))
  }

  return {
    install,
    resetBetweenTests,
    remove: dispose,
    seedOriginEvent,
    failOperation,
    cloneOperation,
    cloneOperations,
    insertAnalyses,
    seedStoredReviewA,
  }
}

export type ReviewAnalysisStoreFixture = ReturnType<
  typeof createReviewAnalysisStoreFixture
>
