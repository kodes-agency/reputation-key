import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { ReviewId } from '#/shared/domain/ids'
import {
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import {
  aiOperationAttempts,
  aiOperations,
  aiProductVolumeConsumptions,
  aiExecutionControlHeads,
  aiPropertyAggregateHeads,
  aiPropertyProcessingProfiles,
  aiPropertyTrendOutcomes,
  aiPropertyTrendSchedules,
  aiReviewAnalyses,
  aiReviewEventCursors,
  merchantAiEnablement,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import type {
  AiOutputStorePort,
  AiTrendReportRead,
} from '../../application/ports/ai-output-store.port'
import type {
  ReviewAnalysisCurrentnessV1,
  ReviewAnalysisReadV1,
} from '../../domain/types'
import {
  acquireAiReadDeliveryLease,
  assertAiReadDeliveryLease,
} from './ai-read-barrier.adapter'

function currentness(
  input: Readonly<{
    sourceEpoch: number
    sourceRevision: number
    analysisSequence: number
    reviewAnalysisEpoch: number
    propertyProfileVersion: number
    analysisProfileVersion: string
  }>,
): ReviewAnalysisCurrentnessV1 {
  return {
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    analysisSequence: input.analysisSequence,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    propertyProfileVersion: input.propertyProfileVersion,
    analysisProfileVersion: input.analysisProfileVersion,
  }
}
function capabilityFence(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

type AiOutputCapability = 'review_analysis' | 'reply_drafting' | 'property_trends'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

type AuthorizedEffectOperation = Readonly<{
  organizationId: string | null
  propertyId: string | null
  sourceEpoch: number | null
  authorizationLineageId: string | null
  noticeVersion: string | null
  noticeDigest: string | null
  propertyProfileVersion: number | null
  routingPolicyVersion: number | null
  sourcePolicyId: string | null
  redactionProfileVersion: string | null
  providerDeploymentProfileVersion: string
  capabilityRuntimeProfileVersion: string | null
  globalControlId: string
  globalControlGeneration: number
  providerControlId: string
  providerControlGeneration: number
  capabilityControlId: string | null
  capabilityControlGeneration: number | null
}>

async function isCurrentAuthorizedEffect(
  tx: Transaction,
  input: Readonly<{
    capability: AiOutputCapability
    operation: AuthorizedEffectOperation
    capabilityFence: Readonly<Record<string, unknown>>
  }>,
): Promise<boolean> {
  const operation = input.operation
  if (
    operation.organizationId === null ||
    operation.propertyId === null ||
    operation.sourceEpoch === null ||
    operation.authorizationLineageId === null ||
    operation.noticeVersion === null ||
    operation.noticeDigest === null ||
    operation.propertyProfileVersion === null ||
    operation.routingPolicyVersion === null ||
    operation.sourcePolicyId === null ||
    operation.redactionProfileVersion === null ||
    operation.capabilityRuntimeProfileVersion === null ||
    operation.capabilityControlId === null ||
    operation.capabilityControlGeneration === null
  ) {
    return false
  }

  const [authorization] = await tx
    .select({
      state: merchantAiEnablement.state,
      authorizationLineageId: merchantAiEnablement.authorizationLineageId,
      capabilities: merchantAiEnablement.capabilities,
      capabilityRuntimeProfileVersions:
        merchantAiEnablement.capabilityRuntimeProfileVersions,
      reviewAnalysisEpoch: merchantAiEnablement.reviewAnalysisEpoch,
      replyDraftingEpoch: merchantAiEnablement.replyDraftingEpoch,
      propertyTrendsEpoch: merchantAiEnablement.propertyTrendsEpoch,
      authorizedSourceEpoch: merchantAiEnablement.authorizedSourceEpoch,
      noticeVersion: merchantAiEnablement.noticeVersion,
      noticeDigest: merchantAiEnablement.noticeDigest,
      sourcePolicyId: merchantAiEnablement.sourcePolicyId,
      routingPolicyVersion: merchantAiEnablement.routingPolicyVersion,
      providerDeploymentProfileVersion:
        merchantAiEnablement.providerDeploymentProfileVersion,
      redactionProfileFamily: merchantAiEnablement.redactionProfileFamily,
    })
    .from(merchantAiEnablement)
    .where(
      and(
        eq(merchantAiEnablement.organizationId, operation.organizationId),
        eq(merchantAiEnablement.propertyId, operation.propertyId),
      ),
    )
    .limit(1)
    .for('share')
  if (
    !authorization ||
    authorization.state !== 'enabled' ||
    authorization.authorizationLineageId !== operation.authorizationLineageId ||
    !authorization.capabilities.includes(input.capability) ||
    authorization.capabilityRuntimeProfileVersions[input.capability] !==
      operation.capabilityRuntimeProfileVersion ||
    authorization.authorizedSourceEpoch !== operation.sourceEpoch ||
    authorization.noticeVersion !== operation.noticeVersion ||
    authorization.noticeDigest !== operation.noticeDigest ||
    authorization.sourcePolicyId !== operation.sourcePolicyId ||
    authorization.routingPolicyVersion !== operation.routingPolicyVersion ||
    authorization.providerDeploymentProfileVersion !==
      operation.providerDeploymentProfileVersion ||
    authorization.redactionProfileFamily !== operation.redactionProfileVersion ||
    (input.capability !== 'reply_drafting' &&
      authorization.reviewAnalysisEpoch !== input.capabilityFence.reviewAnalysisEpoch) ||
    (input.capability === 'reply_drafting' &&
      authorization.replyDraftingEpoch !== input.capabilityFence.replyDraftingEpoch) ||
    (input.capability === 'property_trends' &&
      authorization.propertyTrendsEpoch !== input.capabilityFence.propertyTrendsEpoch)
  ) {
    return false
  }

  const [profile] = await tx
    .select({
      lifecycleState: aiPropertyProcessingProfiles.lifecycleState,
      sourceEpoch: aiPropertyProcessingProfiles.sourceEpoch,
      profileVersion: aiPropertyProcessingProfiles.profileVersion,
      routingPolicyVersion: aiPropertyProcessingProfiles.routingPolicyVersion,
      providerDeploymentProfileVersion:
        aiPropertyProcessingProfiles.providerDeploymentProfileVersion,
    })
    .from(aiPropertyProcessingProfiles)
    .where(
      and(
        eq(aiPropertyProcessingProfiles.organizationId, operation.organizationId),
        eq(aiPropertyProcessingProfiles.propertyId, operation.propertyId),
      ),
    )
    .limit(1)
    .for('share')
  if (
    !profile ||
    profile.lifecycleState !== 'active' ||
    profile.sourceEpoch !== operation.sourceEpoch ||
    profile.profileVersion !== operation.propertyProfileVersion ||
    profile.routingPolicyVersion !== operation.routingPolicyVersion ||
    profile.providerDeploymentProfileVersion !==
      operation.providerDeploymentProfileVersion
  ) {
    return false
  }

  const controls = await tx
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(
      inArray(aiExecutionControlHeads.scopeKey, [
        'global',
        `provider:${operation.providerDeploymentProfileVersion}`,
        `capability:${input.capability}`,
      ]),
    )
    .for('share')
  if (controls.length !== 3) return false
  const byScope = new Map(controls.map((control) => [control.scopeKey, control]))
  const matches = (scopeKey: string, controlId: string, generation: number): boolean => {
    const control = byScope.get(scopeKey)
    return (
      control?.controlId === controlId &&
      control.generation === generation &&
      control.executionState === 'enabled' &&
      control.admissionState === 'accepting'
    )
  }
  return (
    matches('global', operation.globalControlId, operation.globalControlGeneration) &&
    matches(
      `provider:${operation.providerDeploymentProfileVersion}`,
      operation.providerControlId,
      operation.providerControlGeneration,
    ) &&
    matches(
      `capability:${input.capability}`,
      operation.capabilityControlId,
      operation.capabilityControlGeneration,
    )
  )
}

export function createAiOutputStoreAdapter(db: Database): AiOutputStorePort {
  return {
    async storeAnalysis(input) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({
            state: aiOperations.state,
            executionAttempt: aiOperations.executionAttempt,
            command: aiOperations.command,
            capability: aiOperations.capability,
            organizationId: aiOperations.organizationId,
            propertyId: aiOperations.propertyId,
            reviewId: aiOperations.reviewId,
            sourceEpoch: aiOperations.sourceEpoch,
            sourceRevision: aiOperations.sourceRevision,
            sourceDigest: aiOperations.sourceDigest,
            sourceByteCount: aiOperations.sourceByteCount,
            analysisSequence: aiOperations.analysisSequence,
            authorizationLineageId: aiOperations.authorizationLineageId,
            noticeVersion: aiOperations.noticeVersion,
            noticeDigest: aiOperations.noticeDigest,
            propertyProfileVersion: aiOperations.propertyProfileVersion,
            routingPolicyVersion: aiOperations.routingPolicyVersion,
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            providerDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
            capabilityFences: aiOperations.capabilityFences,
            globalControlId: aiOperations.globalControlId,
            globalControlGeneration: aiOperations.globalControlGeneration,
            providerControlId: aiOperations.providerControlId,
            providerControlGeneration: aiOperations.providerControlGeneration,
            capabilityControlId: aiOperations.capabilityControlId,
            capabilityControlGeneration: aiOperations.capabilityControlGeneration,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, input.operationId))
          .limit(1)
          .for('update')
        const fence = capabilityFence(operation?.capabilityFences)
        if (
          operation?.state !== 'executing' ||
          operation.executionAttempt !== input.providerCompletion.expectedAttempt ||
          operation.command !== 'analysis' ||
          operation.capability !== 'review_analysis' ||
          operation.organizationId !== input.organizationId ||
          operation.propertyId !== input.propertyId ||
          operation.reviewId !== input.reviewId ||
          operation.sourceEpoch !== input.sourceEpoch ||
          operation.sourceRevision !== input.sourceRevision ||
          operation.analysisSequence !== input.analysisSequence ||
          operation.authorizationLineageId !== input.authorizationLineageId ||
          operation.propertyProfileVersion !== input.propertyProfileVersion ||
          operation.operationProfileVersion !== input.analysisProfileVersion ||
          operation.capabilityRuntimeProfileVersion !== 'review-analysis-runtime-v1' ||
          fence?.capability !== 'review_analysis' ||
          fence.reviewAnalysisEpoch !== input.reviewAnalysisEpoch
        ) {
          return false
        }
        if (
          !(await isCurrentAuthorizedEffect(tx, {
            capability: 'review_analysis',
            operation,
            capabilityFence: fence,
          }))
        ) {
          return false
        }
        const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)
        const [currentSource] = await tx
          .select({
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            analysisSequence: reviews.analysisSequence,
            sourceDigest: reviews.aiSourceDigest,
            sourceByteCount: reviews.aiSourceByteLength,
            contentExpiresAt: reviews.contentExpiresAt,
            headSequence: reviewAiAnalysisHeads.headSequence,
          })
          .from(reviews)
          .innerJoin(
            reviewAiAnalysisHeads,
            and(
              eq(reviewAiAnalysisHeads.organizationId, reviews.organizationId),
              eq(reviewAiAnalysisHeads.propertyId, reviews.propertyId),
              eq(reviewAiAnalysisHeads.sourceEpoch, reviews.sourceEpoch),
            ),
          )
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !currentSource ||
          currentSource.sourceEpoch !== input.sourceEpoch ||
          currentSource.sourceRevision !== input.sourceRevision ||
          currentSource.analysisSequence !== input.analysisSequence ||
          currentSource.sourceDigest !== operation.sourceDigest ||
          currentSource.sourceByteCount !== operation.sourceByteCount ||
          currentSource.headSequence !== input.analysisSequence ||
          currentSource.contentExpiresAt === null ||
          currentSource.contentExpiresAt <= completedAt
        ) {
          return false
        }
        const [attempt] = await tx
          .select({ attempt: aiOperationAttempts.attempt })
          .from(aiOperationAttempts)
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, operation.executionAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .limit(1)
        if (!attempt) return false

        const settledAttempts = await tx
          .update(aiOperationAttempts)
          .set({
            state: 'completed',
            modelSnapshot: input.providerCompletion.modelSnapshot,
            inputTokens: input.providerCompletion.inputTokens,
            outputTokens: input.providerCompletion.outputTokens,
            settledAt: completedAt,
          })
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, operation.executionAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .returning({ attempt: aiOperationAttempts.attempt })
        if (settledAttempts.length !== 1) {
          throw new Error('AI analysis provider completion commit conflict')
        }

        const [inserted] = await tx
          .insert(aiReviewAnalyses)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reviewId: input.reviewId,
            sourceEpoch: input.sourceEpoch,
            sourceRevision: input.sourceRevision,
            analysisSequence: input.analysisSequence,
            operationId: input.operationId,
            authorizationLineageId: input.authorizationLineageId,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            analysisProfileVersion: input.analysisProfileVersion,
            status: input.result.status,
            unavailableReason:
              input.result.status === 'unavailable' ? input.result.reason : null,
            sentiment:
              input.result.status === 'ready' ? input.result.derivative.sentiment : null,
            primaryCategory:
              input.result.status === 'ready'
                ? input.result.derivative.primaryCategory
                : null,
            attention:
              input.result.status === 'ready' ? input.result.derivative.attention : null,
            generatedAt: new Date(input.generatedAtEpochMillis),
            expiresAt: new Date(input.expiresAtEpochMillis),
          })
          .onConflictDoNothing()
          .returning({ operationId: aiReviewAnalyses.operationId })
        if (!inserted) return false
        await tx.insert(aiProductVolumeConsumptions).values({
          operationId: input.operationId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          capability: 'review_analysis',
          providerDeploymentProfileVersion: operation.providerDeploymentProfileVersion,
          modelSnapshot: input.providerCompletion.modelSnapshot,
          inputTokens: input.providerCompletion.inputTokens,
          outputTokens: input.providerCompletion.outputTokens,
          totalTokens:
            input.providerCompletion.inputTokens + input.providerCompletion.outputTokens,
          completedAt,
        })
        const completed = await tx
          .update(aiOperations)
          .set({ state: 'succeeded_pending_delivery', updatedAt: completedAt })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              eq(aiOperations.state, 'executing'),
              eq(aiOperations.executionAttempt, operation.executionAttempt),
            ),
          )
          .returning({ id: aiOperations.id })
        if (completed.length !== 1) throw new Error('AI analysis result commit conflict')
        return true
      })
    },
    async settleEphemeralReply(input) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({
            state: aiOperations.state,
            executionAttempt: aiOperations.executionAttempt,
            command: aiOperations.command,
            capability: aiOperations.capability,
            organizationId: aiOperations.organizationId,
            propertyId: aiOperations.propertyId,
            reviewId: aiOperations.reviewId,
            actorUserId: aiOperations.actorUserId,
            sourceEpoch: aiOperations.sourceEpoch,
            sourceRevision: aiOperations.sourceRevision,
            sourceDigest: aiOperations.sourceDigest,
            sourceByteCount: aiOperations.sourceByteCount,
            baseReplyStateRevision: aiOperations.baseReplyStateRevision,
            authorizationLineageId: aiOperations.authorizationLineageId,
            noticeVersion: aiOperations.noticeVersion,
            noticeDigest: aiOperations.noticeDigest,
            propertyProfileVersion: aiOperations.propertyProfileVersion,
            routingPolicyVersion: aiOperations.routingPolicyVersion,
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            providerDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
            capabilityFences: aiOperations.capabilityFences,
            globalControlId: aiOperations.globalControlId,
            globalControlGeneration: aiOperations.globalControlGeneration,
            providerControlId: aiOperations.providerControlId,
            providerControlGeneration: aiOperations.providerControlGeneration,
            capabilityControlId: aiOperations.capabilityControlId,
            capabilityControlGeneration: aiOperations.capabilityControlGeneration,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, input.operationId))
          .limit(1)
          .for('update')
        const fence = capabilityFence(operation?.capabilityFences)
        if (
          operation?.state !== 'executing' ||
          operation.executionAttempt !== input.providerCompletion.expectedAttempt ||
          operation.command !== 'reply' ||
          operation.capability !== 'reply_drafting' ||
          operation.organizationId !== input.organizationId ||
          operation.propertyId !== input.propertyId ||
          operation.reviewId !== input.reviewId ||
          operation.actorUserId !== input.actorUserId ||
          operation.sourceEpoch !== input.sourceEpoch ||
          operation.sourceRevision !== input.sourceRevision ||
          operation.baseReplyStateRevision !== input.baseReplyStateRevision ||
          operation.authorizationLineageId !== input.authorizationLineageId ||
          operation.propertyProfileVersion !== input.propertyProfileVersion ||
          operation.operationProfileVersion !== input.replyProfileVersion ||
          operation.capabilityRuntimeProfileVersion !== 'reply-drafting-runtime-v1' ||
          fence?.capability !== 'reply_drafting' ||
          fence.replyDraftingEpoch !== input.replyDraftingEpoch
        ) {
          return false
        }
        if (
          !(await isCurrentAuthorizedEffect(tx, {
            capability: 'reply_drafting',
            operation,
            capabilityFence: fence,
          }))
        ) {
          return false
        }
        const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)
        const [currentSource] = await tx
          .select({
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            contentExpiresAt: reviews.contentExpiresAt,
            sourceDigest: reviews.aiSourceDigest,
            sourceByteCount: reviews.aiSourceByteLength,
            replyStateRevision: reviews.replyStateRevision,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !currentSource ||
          currentSource.sourceEpoch !== input.sourceEpoch ||
          currentSource.sourceRevision !== input.sourceRevision ||
          currentSource.sourceDigest !== operation.sourceDigest ||
          currentSource.sourceByteCount !== operation.sourceByteCount ||
          currentSource.contentExpiresAt === null ||
          currentSource.contentExpiresAt <= completedAt ||
          currentSource.replyStateRevision !== input.baseReplyStateRevision
        ) {
          return false
        }
        const settledAttempts = await tx
          .update(aiOperationAttempts)
          .set({
            state: 'completed',
            modelSnapshot: input.providerCompletion.modelSnapshot,
            inputTokens: input.providerCompletion.inputTokens,
            outputTokens: input.providerCompletion.outputTokens,
            settledAt: completedAt,
          })
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, input.providerCompletion.expectedAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .returning({ attempt: aiOperationAttempts.attempt })
        if (settledAttempts.length !== 1) {
          throw new Error('AI reply provider completion commit conflict')
        }
        await tx.insert(aiProductVolumeConsumptions).values({
          operationId: input.operationId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          capability: 'reply_drafting',
          providerDeploymentProfileVersion: operation.providerDeploymentProfileVersion,
          modelSnapshot: input.providerCompletion.modelSnapshot,
          inputTokens: input.providerCompletion.inputTokens,
          outputTokens: input.providerCompletion.outputTokens,
          totalTokens:
            input.providerCompletion.inputTokens + input.providerCompletion.outputTokens,
          completedAt,
        })
        const completed = await tx
          .update(aiOperations)
          .set({ state: 'succeeded_pending_delivery', updatedAt: completedAt })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              eq(aiOperations.state, 'executing'),
              eq(aiOperations.executionAttempt, input.providerCompletion.expectedAttempt),
            ),
          )
          .returning({ id: aiOperations.id })
        if (completed.length !== 1) {
          throw new Error('AI reply operation completion commit conflict')
        }
        return true
      })
    },
    async findCurrentReviewIdsByAttention(input) {
      if (input.attention.length === 0 || input.propertyIds?.length === 0) return []
      const now = new Date(input.nowEpochMillis)
      const conditions = [
        eq(aiReviewAnalyses.organizationId, input.organizationId),
        eq(aiReviewAnalyses.status, 'ready'),
        inArray(aiReviewAnalyses.attention, [...input.attention]),
        gt(aiReviewAnalyses.expiresAt, now),
        eq(merchantAiEnablement.state, 'enabled'),
        sql`${merchantAiEnablement.capabilities} @> ARRAY['review_analysis']::text[]`,
        eq(
          aiReviewAnalyses.authorizationLineageId,
          merchantAiEnablement.authorizationLineageId,
        ),
        eq(
          aiReviewAnalyses.reviewAnalysisEpoch,
          merchantAiEnablement.reviewAnalysisEpoch,
        ),
        eq(aiReviewAnalyses.sourceEpoch, merchantAiEnablement.authorizedSourceEpoch),
        eq(aiReviewAnalyses.sourceEpoch, reviews.sourceEpoch),
        eq(aiReviewAnalyses.sourceRevision, reviews.sourceRevision),
        eq(aiReviewAnalyses.analysisSequence, reviews.analysisSequence),
        gt(reviews.contentExpiresAt, now),
        eq(aiPropertyProcessingProfiles.lifecycleState, 'active'),
        eq(
          aiReviewAnalyses.propertyProfileVersion,
          aiPropertyProcessingProfiles.profileVersion,
        ),
        eq(aiReviewAnalyses.sourceEpoch, aiPropertyProcessingProfiles.sourceEpoch),
        eq(aiReviewAnalyses.analysisProfileVersion, 'review-analysis-v1'),
      ]
      if (input.propertyIds) {
        conditions.push(inArray(aiReviewAnalyses.propertyId, [...input.propertyIds]))
      }
      const rows = await db
        .selectDistinct({ reviewId: aiReviewAnalyses.reviewId })
        .from(aiReviewAnalyses)
        .innerJoin(
          reviews,
          and(
            eq(reviews.organizationId, aiReviewAnalyses.organizationId),
            eq(reviews.propertyId, aiReviewAnalyses.propertyId),
            eq(reviews.id, aiReviewAnalyses.reviewId),
          ),
        )
        .innerJoin(
          merchantAiEnablement,
          and(
            eq(merchantAiEnablement.organizationId, aiReviewAnalyses.organizationId),
            eq(merchantAiEnablement.propertyId, aiReviewAnalyses.propertyId),
          ),
        )
        .innerJoin(
          aiPropertyProcessingProfiles,
          and(
            eq(
              aiPropertyProcessingProfiles.organizationId,
              aiReviewAnalyses.organizationId,
            ),
            eq(aiPropertyProcessingProfiles.propertyId, aiReviewAnalyses.propertyId),
          ),
        )
        .where(and(...conditions))
      return rows.map((row) => row.reviewId as ReviewId)
    },

    async storeTrendReport(input) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({
            state: aiOperations.state,
            executionAttempt: aiOperations.executionAttempt,
            command: aiOperations.command,
            capability: aiOperations.capability,
            organizationId: aiOperations.organizationId,
            propertyId: aiOperations.propertyId,
            sourceEpoch: aiOperations.sourceEpoch,
            dueLocalDate: aiOperations.dueLocalDate,
            terminalAnalysisSequence: aiOperations.terminalAnalysisSequence,
            aggregateRevision: aiOperations.aggregateRevision,
            authorizationLineageId: aiOperations.authorizationLineageId,
            noticeVersion: aiOperations.noticeVersion,
            noticeDigest: aiOperations.noticeDigest,
            propertyProfileVersion: aiOperations.propertyProfileVersion,
            routingPolicyVersion: aiOperations.routingPolicyVersion,
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
            providerDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            capabilityFences: aiOperations.capabilityFences,
            globalControlId: aiOperations.globalControlId,
            globalControlGeneration: aiOperations.globalControlGeneration,
            providerControlId: aiOperations.providerControlId,
            providerControlGeneration: aiOperations.providerControlGeneration,
            capabilityControlId: aiOperations.capabilityControlId,
            capabilityControlGeneration: aiOperations.capabilityControlGeneration,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, input.operationId))
          .limit(1)
          .for('update')
        const [schedule] = await tx
          .select({
            organizationId: aiPropertyTrendSchedules.organizationId,
            propertyId: aiPropertyTrendSchedules.propertyId,
            dueLocalDate: aiPropertyTrendSchedules.dueLocalDate,
            sourceEpoch: aiPropertyTrendSchedules.sourceEpoch,
            reviewAnalysisEpoch: aiPropertyTrendSchedules.reviewAnalysisEpoch,
            propertyTrendsEpoch: aiPropertyTrendSchedules.propertyTrendsEpoch,
            propertyProfileVersion: aiPropertyTrendSchedules.propertyProfileVersion,
            terminalAnalysisSequence: aiPropertyTrendSchedules.terminalAnalysisSequence,
            aggregateRevision: aiPropertyTrendSchedules.aggregateRevision,
            reportProfileVersion: aiPropertyTrendSchedules.reportProfileVersion,
          })
          .from(aiPropertyTrendSchedules)
          .where(eq(aiPropertyTrendSchedules.id, input.scheduleId))
          .limit(1)
          .for('share')
        const fence = capabilityFence(operation?.capabilityFences)
        if (
          operation?.state !== 'executing' ||
          operation.executionAttempt !== input.providerCompletion.expectedAttempt ||
          operation.command !== 'trend' ||
          operation.capability !== 'property_trends' ||
          operation.organizationId !== input.organizationId ||
          operation.propertyId !== input.propertyId ||
          operation.sourceEpoch !== input.sourceEpoch ||
          operation.dueLocalDate !== input.dueLocalDate ||
          operation.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          operation.aggregateRevision !== input.aggregateRevision ||
          operation.propertyProfileVersion !== input.propertyProfileVersion ||
          operation.operationProfileVersion !== input.reportProfileVersion ||
          operation.capabilityRuntimeProfileVersion !== 'property-trends-runtime-v1' ||
          !schedule ||
          schedule.organizationId !== input.organizationId ||
          schedule.propertyId !== input.propertyId ||
          schedule.dueLocalDate !== input.dueLocalDate ||
          schedule.sourceEpoch !== input.sourceEpoch ||
          schedule.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          schedule.propertyTrendsEpoch !== input.propertyTrendsEpoch ||
          schedule.propertyProfileVersion !== input.propertyProfileVersion ||
          schedule.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          schedule.aggregateRevision !== input.aggregateRevision ||
          schedule.reportProfileVersion !== input.reportProfileVersion ||
          input.report.headline === undefined ||
          input.report.sentences === undefined ||
          input.report.summary === undefined ||
          fence?.capability !== 'property_trends' ||
          fence.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          fence.propertyTrendsEpoch !== input.propertyTrendsEpoch
        ) {
          return false
        }
        if (
          !(await isCurrentAuthorizedEffect(tx, {
            capability: 'property_trends',
            operation,
            capabilityFence: fence,
          }))
        ) {
          return false
        }
        const [reviewHead] = await tx
          .select({ headSequence: reviewAiAnalysisHeads.headSequence })
          .from(reviewAiAnalysisHeads)
          .where(
            and(
              eq(reviewAiAnalysisHeads.organizationId, input.organizationId),
              eq(reviewAiAnalysisHeads.propertyId, input.propertyId),
              eq(reviewAiAnalysisHeads.sourceEpoch, input.sourceEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const [cursor] = await tx
          .select({
            consumedSequence: aiReviewEventCursors.consumedSequence,
            terminalAnalysisSequence: aiReviewEventCursors.terminalAnalysisSequence,
            aggregateRevision: aiReviewEventCursors.aggregateRevision,
          })
          .from(aiReviewEventCursors)
          .where(
            and(
              eq(aiReviewEventCursors.organizationId, input.organizationId),
              eq(aiReviewEventCursors.propertyId, input.propertyId),
              eq(aiReviewEventCursors.sourceEpoch, input.sourceEpoch),
              eq(aiReviewEventCursors.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const [aggregateHead] = await tx
          .select({
            terminalAnalysisSequence: aiPropertyAggregateHeads.terminalAnalysisSequence,
            aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
          })
          .from(aiPropertyAggregateHeads)
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !reviewHead ||
          !cursor ||
          !aggregateHead ||
          reviewHead.headSequence !== input.terminalAnalysisSequence ||
          cursor.consumedSequence !== input.terminalAnalysisSequence ||
          cursor.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          cursor.aggregateRevision !== input.aggregateRevision ||
          aggregateHead.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          aggregateHead.aggregateRevision !== input.aggregateRevision
        ) {
          return false
        }
        const [attempt] = await tx
          .select({ attempt: aiOperationAttempts.attempt })
          .from(aiOperationAttempts)
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, operation.executionAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .limit(1)
        if (!attempt) return false
        const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)
        const settledAttempts = await tx
          .update(aiOperationAttempts)
          .set({
            state: 'completed',
            modelSnapshot: input.providerCompletion.modelSnapshot,
            inputTokens: input.providerCompletion.inputTokens,
            outputTokens: input.providerCompletion.outputTokens,
            settledAt: completedAt,
          })
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, operation.executionAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .returning({ attempt: aiOperationAttempts.attempt })
        if (settledAttempts.length !== 1) {
          throw new Error('AI trend provider completion commit conflict')
        }

        const [inserted] = await tx
          .insert(aiPropertyTrendOutcomes)
          .values({
            scheduleId: input.scheduleId,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            disposition: 'ready',
            operationId: input.operationId,
            selectedSignalIds: [...input.selectedSignalIds],
            signalKey: input.report.signalKey,
            direction: input.report.direction,
            confidenceBasisPoints: input.report.confidenceBasisPoints,
            supportingReviewCount: input.report.supportingReviewCount,
            headline: input.report.headline,
            sentences: [...input.report.sentences],
            summary: input.report.summary,
            renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
            renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
            providerSelectionRecordedAt: completedAt,
            recordedAt: completedAt,
            expiresAt: new Date(input.expiresAtEpochMillis),
          })
          .onConflictDoNothing()
          .returning({ operationId: aiPropertyTrendOutcomes.operationId })
        if (!inserted) return false
        await tx.insert(aiProductVolumeConsumptions).values({
          operationId: input.operationId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          capability: 'property_trends',
          providerDeploymentProfileVersion: operation.providerDeploymentProfileVersion,
          modelSnapshot: input.providerCompletion.modelSnapshot,
          inputTokens: input.providerCompletion.inputTokens,
          outputTokens: input.providerCompletion.outputTokens,
          totalTokens:
            input.providerCompletion.inputTokens + input.providerCompletion.outputTokens,
          completedAt,
        })
        const completed = await tx
          .update(aiOperations)
          .set({ state: 'succeeded_pending_delivery', updatedAt: completedAt })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              eq(aiOperations.state, 'executing'),
              eq(aiOperations.executionAttempt, operation.executionAttempt),
            ),
          )
          .returning({ id: aiOperations.id })
        if (completed.length !== 1) throw new Error('AI trend result commit conflict')
        return true
      })
    },

    async readAnalysisForDelivery(input, deliver) {
      return db.transaction(async (tx) => {
        const lease = await acquireAiReadDeliveryLease(tx, input)
        if (!lease) throw new Error('AI read delivery is closing')
        const deliverCurrent = async (result: ReviewAnalysisReadV1) => {
          if (
            !(await assertAiReadDeliveryLease(tx, {
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              actorUserId: input.actorUserId,
              lease,
            }))
          ) {
            throw new Error('AI read delivery lease is stale')
          }
          return deliver(lease, result)
        }
        const [authorization] = await tx
          .select({
            state: merchantAiEnablement.state,
            authorizationLineageId: merchantAiEnablement.authorizationLineageId,
            capabilities: merchantAiEnablement.capabilities,
            reviewAnalysisEpoch: merchantAiEnablement.reviewAnalysisEpoch,
            sourceEpoch: merchantAiEnablement.authorizedSourceEpoch,
            analysisStartSequence: merchantAiEnablement.analysisStartSequence,
            capabilityRuntimeProfileVersions:
              merchantAiEnablement.capabilityRuntimeProfileVersions,
            noticeVersion: merchantAiEnablement.noticeVersion,
            noticeDigest: merchantAiEnablement.noticeDigest,
            sourcePolicyId: merchantAiEnablement.sourcePolicyId,
            routingPolicyVersion: merchantAiEnablement.routingPolicyVersion,
            providerDeploymentProfileVersion:
              merchantAiEnablement.providerDeploymentProfileVersion,
            redactionProfileFamily: merchantAiEnablement.redactionProfileFamily,
          })
          .from(merchantAiEnablement)
          .where(
            and(
              eq(merchantAiEnablement.organizationId, input.organizationId),
              eq(merchantAiEnablement.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('share')

        const authorized =
          authorization?.state === 'enabled' &&
          authorization.authorizationLineageId === input.authorizationLineageId &&
          authorization.capabilities.includes('review_analysis') &&
          authorization.reviewAnalysisEpoch === input.reviewAnalysisEpoch &&
          authorization.sourceEpoch === input.sourceEpoch &&
          input.analysisSequence >= authorization.analysisStartSequence
        if (!authorized) {
          return deliverCurrent({ status: 'disabled' })
        }

        const [profile] = await tx
          .select({
            profileVersion: aiPropertyProcessingProfiles.profileVersion,
            sourceEpoch: aiPropertyProcessingProfiles.sourceEpoch,
            lifecycleState: aiPropertyProcessingProfiles.lifecycleState,
            routingPolicyVersion: aiPropertyProcessingProfiles.routingPolicyVersion,
            providerDeploymentProfileVersion:
              aiPropertyProcessingProfiles.providerDeploymentProfileVersion,
          })
          .from(aiPropertyProcessingProfiles)
          .where(
            and(
              eq(aiPropertyProcessingProfiles.organizationId, input.organizationId),
              eq(aiPropertyProcessingProfiles.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !profile ||
          profile.lifecycleState !== 'active' ||
          profile.profileVersion !== input.propertyProfileVersion ||
          profile.sourceEpoch !== input.sourceEpoch
        ) {
          return deliverCurrent({
            status: 'none',
            ...currentness(input),
          })
        }

        const now = new Date(input.nowEpochMillis)
        const [review] = await tx
          .select({
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            analysisSequence: reviews.analysisSequence,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
              gt(reviews.contentExpiresAt, now),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !review ||
          review.sourceEpoch !== input.sourceEpoch ||
          review.sourceRevision !== input.sourceRevision ||
          review.analysisSequence !== input.analysisSequence
        ) {
          return deliverCurrent({
            status: 'none',
            ...currentness(input),
          })
        }

        const [analysis] = await tx
          .select({
            status: aiReviewAnalyses.status,
            sentiment: aiReviewAnalyses.sentiment,
            primaryCategory: aiReviewAnalyses.primaryCategory,
            attention: aiReviewAnalyses.attention,
            generatedAt: aiReviewAnalyses.generatedAt,
            operationState: aiOperations.state,
            operationCommand: aiOperations.command,
            operationCapability: aiOperations.capability,
            operationOrganizationId: aiOperations.organizationId,
            operationPropertyId: aiOperations.propertyId,
            operationReviewId: aiOperations.reviewId,
            operationSourceEpoch: aiOperations.sourceEpoch,
            operationSourceRevision: aiOperations.sourceRevision,
            operationAnalysisSequence: aiOperations.analysisSequence,
            operationAuthorizationLineageId: aiOperations.authorizationLineageId,
            operationPropertyProfileVersion: aiOperations.propertyProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            operationCapabilityRuntimeProfileVersion:
              aiOperations.capabilityRuntimeProfileVersion,
            operationNoticeVersion: aiOperations.noticeVersion,
            operationNoticeDigest: aiOperations.noticeDigest,
            operationSourcePolicyId: aiOperations.sourcePolicyId,
            operationRoutingPolicyVersion: aiOperations.routingPolicyVersion,
            operationProviderDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            operationRedactionProfileVersion: aiOperations.redactionProfileVersion,
            operationCapabilityFences: aiOperations.capabilityFences,
          })
          .from(aiReviewAnalyses)
          .innerJoin(aiOperations, eq(aiOperations.id, aiReviewAnalyses.operationId))
          .where(
            and(
              eq(aiReviewAnalyses.organizationId, input.organizationId),
              eq(aiReviewAnalyses.propertyId, input.propertyId),
              eq(aiReviewAnalyses.reviewId, input.reviewId),
              eq(aiReviewAnalyses.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalyses.sourceRevision, input.sourceRevision),
              eq(aiReviewAnalyses.analysisSequence, input.analysisSequence),
              eq(aiReviewAnalyses.authorizationLineageId, input.authorizationLineageId),
              eq(aiReviewAnalyses.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(aiReviewAnalyses.propertyProfileVersion, input.propertyProfileVersion),
              eq(aiReviewAnalyses.analysisProfileVersion, input.analysisProfileVersion),
              gt(aiReviewAnalyses.expiresAt, now),
            ),
          )
          .limit(1)
          .for('share')

        const analysisFence = capabilityFence(analysis?.operationCapabilityFences)
        const operationCurrent =
          analysis !== undefined &&
          (analysis.operationState === 'succeeded' ||
            analysis.operationState === 'succeeded_pending_delivery') &&
          analysis.operationCommand === 'analysis' &&
          analysis.operationCapability === 'review_analysis' &&
          analysis.operationOrganizationId === input.organizationId &&
          analysis.operationPropertyId === input.propertyId &&
          analysis.operationReviewId === input.reviewId &&
          analysis.operationSourceEpoch === input.sourceEpoch &&
          analysis.operationSourceRevision === input.sourceRevision &&
          analysis.operationAnalysisSequence === input.analysisSequence &&
          analysis.operationAuthorizationLineageId === input.authorizationLineageId &&
          analysis.operationPropertyProfileVersion === input.propertyProfileVersion &&
          analysis.operationProfileVersion === input.analysisProfileVersion &&
          analysis.operationCapabilityRuntimeProfileVersion ===
            authorization.capabilityRuntimeProfileVersions.review_analysis &&
          analysis.operationNoticeVersion === authorization.noticeVersion &&
          analysis.operationNoticeDigest === authorization.noticeDigest &&
          analysis.operationSourcePolicyId === authorization.sourcePolicyId &&
          analysis.operationRoutingPolicyVersion === authorization.routingPolicyVersion &&
          analysis.operationRoutingPolicyVersion === profile.routingPolicyVersion &&
          analysis.operationProviderDeploymentProfileVersion ===
            authorization.providerDeploymentProfileVersion &&
          analysis.operationProviderDeploymentProfileVersion ===
            profile.providerDeploymentProfileVersion &&
          analysis.operationRedactionProfileVersion ===
            authorization.redactionProfileFamily &&
          analysisFence?.capability === 'review_analysis' &&
          analysisFence.reviewAnalysisEpoch === input.reviewAnalysisEpoch
        if (!operationCurrent) {
          return deliverCurrent({
            status: 'none',
            ...currentness(input),
          })
        }
        if (analysis.status === 'unavailable') {
          return deliverCurrent({
            status: 'unavailable',
            reason: 'language_not_supported',
            ...currentness(input),
          })
        }
        if (
          analysis.sentiment === null ||
          analysis.primaryCategory === null ||
          analysis.attention === null
        ) {
          throw new Error('Ready AI analysis row is incomplete')
        }
        return deliverCurrent({
          status: 'ready',
          sentiment: analysis.sentiment as 'positive' | 'neutral' | 'negative' | 'mixed',
          primaryCategory: analysis.primaryCategory as Extract<
            ReviewAnalysisReadV1,
            { status: 'ready' }
          >['primaryCategory'],
          attention: analysis.attention as 'urgent' | 'high' | 'medium' | 'low',
          generatedAtEpochMillis: analysis.generatedAt.getTime(),
          ...currentness(input),
        })
      })
    },

    async readTrendReportForDelivery(input, deliver) {
      return db.transaction(async (tx) => {
        const lease = await acquireAiReadDeliveryLease(tx, input)
        if (!lease) throw new Error('AI read delivery is closing')
        const deliverCurrent = async (result: AiTrendReportRead) => {
          if (
            !(await assertAiReadDeliveryLease(tx, {
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              actorUserId: input.actorUserId,
              lease,
            }))
          ) {
            throw new Error('AI read delivery lease is stale')
          }
          return deliver(lease, result)
        }
        const preparing = (): AiTrendReportRead => ({
          status: 'preparing',
          sourceEpoch: input.sourceEpoch,
          reviewAnalysisEpoch: input.reviewAnalysisEpoch,
          propertyTrendsEpoch: input.propertyTrendsEpoch,
          propertyProfileVersion: input.propertyProfileVersion,
        })
        const [authorization] = await tx
          .select({
            state: merchantAiEnablement.state,
            authorizationLineageId: merchantAiEnablement.authorizationLineageId,
            capabilities: merchantAiEnablement.capabilities,
            reviewAnalysisEpoch: merchantAiEnablement.reviewAnalysisEpoch,
            propertyTrendsEpoch: merchantAiEnablement.propertyTrendsEpoch,
            sourceEpoch: merchantAiEnablement.authorizedSourceEpoch,
            capabilityRuntimeProfileVersions:
              merchantAiEnablement.capabilityRuntimeProfileVersions,
            noticeVersion: merchantAiEnablement.noticeVersion,
            noticeDigest: merchantAiEnablement.noticeDigest,
            sourcePolicyId: merchantAiEnablement.sourcePolicyId,
            routingPolicyVersion: merchantAiEnablement.routingPolicyVersion,
            providerDeploymentProfileVersion:
              merchantAiEnablement.providerDeploymentProfileVersion,
            redactionProfileFamily: merchantAiEnablement.redactionProfileFamily,
          })
          .from(merchantAiEnablement)
          .where(
            and(
              eq(merchantAiEnablement.organizationId, input.organizationId),
              eq(merchantAiEnablement.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('share')
        if (
          authorization?.state !== 'enabled' ||
          !authorization.capabilities.includes('property_trends') ||
          authorization.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          authorization.propertyTrendsEpoch !== input.propertyTrendsEpoch ||
          authorization.sourceEpoch !== input.sourceEpoch
        ) {
          return deliverCurrent({ status: 'disabled' })
        }

        const [profile] = await tx
          .select()
          .from(aiPropertyProcessingProfiles)
          .where(
            and(
              eq(aiPropertyProcessingProfiles.organizationId, input.organizationId),
              eq(aiPropertyProcessingProfiles.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !profile ||
          profile.lifecycleState !== 'active' ||
          profile.profileVersion !== input.propertyProfileVersion ||
          profile.sourceEpoch !== input.sourceEpoch
        ) {
          return deliverCurrent(preparing())
        }

        const [reviewHead] = await tx
          .select({ headSequence: reviewAiAnalysisHeads.headSequence })
          .from(reviewAiAnalysisHeads)
          .where(
            and(
              eq(reviewAiAnalysisHeads.organizationId, input.organizationId),
              eq(reviewAiAnalysisHeads.propertyId, input.propertyId),
              eq(reviewAiAnalysisHeads.sourceEpoch, input.sourceEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const [cursor] = await tx
          .select({
            consumedSequence: aiReviewEventCursors.consumedSequence,
            terminalAnalysisSequence: aiReviewEventCursors.terminalAnalysisSequence,
            aggregateRevision: aiReviewEventCursors.aggregateRevision,
          })
          .from(aiReviewEventCursors)
          .where(
            and(
              eq(aiReviewEventCursors.organizationId, input.organizationId),
              eq(aiReviewEventCursors.propertyId, input.propertyId),
              eq(aiReviewEventCursors.sourceEpoch, input.sourceEpoch),
              eq(aiReviewEventCursors.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const [aggregateHead] = await tx
          .select({
            terminalAnalysisSequence: aiPropertyAggregateHeads.terminalAnalysisSequence,
            aggregateRevision: aiPropertyAggregateHeads.aggregateRevision,
          })
          .from(aiPropertyAggregateHeads)
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !reviewHead ||
          !cursor ||
          !aggregateHead ||
          reviewHead.headSequence !== cursor.consumedSequence ||
          cursor.consumedSequence !== cursor.terminalAnalysisSequence ||
          aggregateHead.terminalAnalysisSequence !== cursor.terminalAnalysisSequence ||
          aggregateHead.aggregateRevision !== cursor.aggregateRevision
        ) {
          return deliverCurrent(preparing())
        }

        const now = new Date(input.nowEpochMillis)
        const [report] = await tx
          .select({
            disposition: aiPropertyTrendOutcomes.disposition,
            dueLocalDate: aiPropertyTrendSchedules.dueLocalDate,
            terminalAnalysisSequence: aiPropertyTrendSchedules.terminalAnalysisSequence,
            aggregateRevision: aiPropertyTrendSchedules.aggregateRevision,
            signalKey: aiPropertyTrendOutcomes.signalKey,
            direction: aiPropertyTrendOutcomes.direction,
            confidenceBasisPoints: aiPropertyTrendOutcomes.confidenceBasisPoints,
            supportingReviewCount: aiPropertyTrendOutcomes.supportingReviewCount,
            headline: aiPropertyTrendOutcomes.headline,
            sentences: aiPropertyTrendOutcomes.sentences,
            summary: aiPropertyTrendOutcomes.summary,
            renderProfileVersion: aiPropertyTrendOutcomes.renderProfileVersion,
            renderProfileDigest: aiPropertyTrendOutcomes.renderProfileDigest,
            generatedAt: aiPropertyTrendOutcomes.recordedAt,
            operationState: aiOperations.state,
            operationCommand: aiOperations.command,
            operationCapability: aiOperations.capability,
            operationOrganizationId: aiOperations.organizationId,
            operationPropertyId: aiOperations.propertyId,
            operationSourceEpoch: aiOperations.sourceEpoch,
            operationDueLocalDate: aiOperations.dueLocalDate,
            operationTerminalAnalysisSequence: aiOperations.terminalAnalysisSequence,
            operationAggregateRevision: aiOperations.aggregateRevision,
            operationAuthorizationLineageId: aiOperations.authorizationLineageId,
            operationPropertyProfileVersion: aiOperations.propertyProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            operationCapabilityRuntimeProfileVersion:
              aiOperations.capabilityRuntimeProfileVersion,
            operationNoticeVersion: aiOperations.noticeVersion,
            operationNoticeDigest: aiOperations.noticeDigest,
            operationSourcePolicyId: aiOperations.sourcePolicyId,
            operationRoutingPolicyVersion: aiOperations.routingPolicyVersion,
            operationProviderDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            operationRedactionProfileVersion: aiOperations.redactionProfileVersion,
            operationCapabilityFences: aiOperations.capabilityFences,
          })
          .from(aiPropertyTrendOutcomes)
          .innerJoin(
            aiPropertyTrendSchedules,
            eq(aiPropertyTrendSchedules.id, aiPropertyTrendOutcomes.scheduleId),
          )
          .leftJoin(
            aiOperations,
            eq(aiOperations.id, aiPropertyTrendOutcomes.operationId),
          )
          .where(
            and(
              eq(aiPropertyTrendSchedules.organizationId, input.organizationId),
              eq(aiPropertyTrendSchedules.propertyId, input.propertyId),
              eq(aiPropertyTrendSchedules.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyTrendSchedules.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(aiPropertyTrendSchedules.propertyTrendsEpoch, input.propertyTrendsEpoch),
              eq(
                aiPropertyTrendSchedules.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              eq(
                aiPropertyTrendSchedules.reportProfileVersion,
                input.reportProfileVersion,
              ),
              or(
                isNull(aiPropertyTrendOutcomes.expiresAt),
                gt(aiPropertyTrendOutcomes.expiresAt, now),
              ),
            ),
          )
          .orderBy(
            desc(aiPropertyTrendSchedules.dueLocalDate),
            desc(aiPropertyTrendSchedules.aggregateRevision),
          )
          .limit(1)
        if (
          report &&
          (report.terminalAnalysisSequence !== cursor.terminalAnalysisSequence ||
            report.aggregateRevision !== cursor.aggregateRevision)
        ) {
          return deliverCurrent({
            status: 'snapshot_superseded',
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyTrendsEpoch: input.propertyTrendsEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            terminalAnalysisSequence: cursor.terminalAnalysisSequence,
            aggregateRevision: cursor.aggregateRevision,
          })
        }
        if (
          report?.disposition === 'insufficient_data' ||
          report?.disposition === 'no_material_change'
        ) {
          return deliverCurrent({
            status: report.disposition,
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyTrendsEpoch: input.propertyTrendsEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            dueLocalDate: report.dueLocalDate,
            terminalAnalysisSequence: report.terminalAnalysisSequence,
            aggregateRevision: report.aggregateRevision,
          })
        }
        const fence = capabilityFence(report?.operationCapabilityFences)
        if (
          !report ||
          report.disposition !== 'ready' ||
          (report.operationState !== 'succeeded' &&
            report.operationState !== 'succeeded_pending_delivery') ||
          report.operationCommand !== 'trend' ||
          report.operationCapability !== 'property_trends' ||
          report.operationOrganizationId !== input.organizationId ||
          report.operationPropertyId !== input.propertyId ||
          report.operationSourceEpoch !== input.sourceEpoch ||
          report.operationDueLocalDate !== report.dueLocalDate ||
          report.operationTerminalAnalysisSequence !== report.terminalAnalysisSequence ||
          report.operationAggregateRevision !== report.aggregateRevision ||
          report.operationAuthorizationLineageId !==
            authorization.authorizationLineageId ||
          report.operationPropertyProfileVersion !== input.propertyProfileVersion ||
          report.operationProfileVersion !== input.reportProfileVersion ||
          report.operationCapabilityRuntimeProfileVersion !==
            authorization.capabilityRuntimeProfileVersions.property_trends ||
          report.operationNoticeVersion !== authorization.noticeVersion ||
          report.operationNoticeDigest !== authorization.noticeDigest ||
          report.operationSourcePolicyId !== authorization.sourcePolicyId ||
          report.operationRoutingPolicyVersion !== authorization.routingPolicyVersion ||
          report.operationRoutingPolicyVersion !== profile.routingPolicyVersion ||
          report.operationProviderDeploymentProfileVersion !==
            authorization.providerDeploymentProfileVersion ||
          report.operationProviderDeploymentProfileVersion !==
            profile.providerDeploymentProfileVersion ||
          report.operationRedactionProfileVersion !==
            authorization.redactionProfileFamily ||
          report.renderProfileVersion !== AI_TREND_RENDER_PROFILE_VERSION ||
          report.renderProfileDigest !== AI_TREND_RENDER_PROFILE_DIGEST ||
          report.signalKey === null ||
          report.direction === null ||
          report.confidenceBasisPoints === null ||
          report.supportingReviewCount === null ||
          report.headline === null ||
          !Array.isArray(report.sentences) ||
          report.summary === null ||
          fence?.capability !== 'property_trends' ||
          fence.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          fence.propertyTrendsEpoch !== input.propertyTrendsEpoch
        ) {
          return deliverCurrent(preparing())
        }
        return deliverCurrent({
          status: 'ready',
          sourceEpoch: input.sourceEpoch,
          reviewAnalysisEpoch: input.reviewAnalysisEpoch,
          propertyTrendsEpoch: input.propertyTrendsEpoch,
          propertyProfileVersion: input.propertyProfileVersion,
          dueLocalDate: report.dueLocalDate,
          terminalAnalysisSequence: report.terminalAnalysisSequence,
          aggregateRevision: report.aggregateRevision,
          reportProfileVersion: input.reportProfileVersion,
          report: {
            signalKey: report.signalKey,
            direction: report.direction as 'improving' | 'stable' | 'declining',
            confidenceBasisPoints: report.confidenceBasisPoints,
            supportingReviewCount: report.supportingReviewCount,
            headline: report.headline as
              | 'Review signals improved'
              | 'Review signals need attention'
              | 'Notable review changes',
            sentences: report.sentences as readonly string[],
            summary: report.summary,
          },
          generatedAtEpochMillis: report.generatedAt.getTime(),
        })
      })
    },
  }
}
