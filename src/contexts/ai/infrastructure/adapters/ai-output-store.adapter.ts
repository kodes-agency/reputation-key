import { and, desc, eq, gt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiOperationAttempts,
  aiOperations,
  aiProductVolumeConsumptions,
  aiPropertyAggregateHeads,
  aiPropertyProcessingProfiles,
  aiPropertyTrendReports,
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
            analysisSequence: aiOperations.analysisSequence,
            authorizationLineageId: aiOperations.authorizationLineageId,
            propertyProfileVersion: aiOperations.propertyProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            providerDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
            capabilityFences: aiOperations.capabilityFences,
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
        const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)
        const [currentSource] = await tx
          .select({
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            analysisSequence: reviews.analysisSequence,
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
            propertyProfileVersion: aiOperations.propertyProfileVersion,
            operationProfileVersion: aiOperations.operationProfileVersion,
            capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
            providerDeploymentProfileVersion:
              aiOperations.providerDeploymentProfileVersion,
            capabilityFences: aiOperations.capabilityFences,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, input.operationId))
          .limit(1)
          .for('update')
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
          fence?.capability !== 'property_trends' ||
          fence.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          fence.propertyTrendsEpoch !== input.propertyTrendsEpoch
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
          .insert(aiPropertyTrendReports)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            dueLocalDate: input.dueLocalDate,
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyTrendsEpoch: input.propertyTrendsEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            terminalAnalysisSequence: input.terminalAnalysisSequence,
            aggregateRevision: input.aggregateRevision,
            operationId: input.operationId,
            reportProfileVersion: input.reportProfileVersion,
            signalKey: input.report.signalKey,
            direction: input.report.direction,
            confidenceBasisPoints: input.report.confidenceBasisPoints,
            supportingReviewCount: input.report.supportingReviewCount,
            generatedAt: new Date(input.generatedAtEpochMillis),
            expiresAt: new Date(input.expiresAtEpochMillis),
          })
          .onConflictDoNothing()
          .returning({ operationId: aiPropertyTrendReports.operationId })
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
            dueLocalDate: aiPropertyTrendReports.dueLocalDate,
            terminalAnalysisSequence: aiPropertyTrendReports.terminalAnalysisSequence,
            aggregateRevision: aiPropertyTrendReports.aggregateRevision,
            signalKey: aiPropertyTrendReports.signalKey,
            direction: aiPropertyTrendReports.direction,
            confidenceBasisPoints: aiPropertyTrendReports.confidenceBasisPoints,
            supportingReviewCount: aiPropertyTrendReports.supportingReviewCount,
            generatedAt: aiPropertyTrendReports.generatedAt,
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
          .from(aiPropertyTrendReports)
          .innerJoin(
            aiOperations,
            eq(aiOperations.id, aiPropertyTrendReports.operationId),
          )
          .where(
            and(
              eq(aiPropertyTrendReports.organizationId, input.organizationId),
              eq(aiPropertyTrendReports.propertyId, input.propertyId),
              eq(aiPropertyTrendReports.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyTrendReports.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(aiPropertyTrendReports.propertyTrendsEpoch, input.propertyTrendsEpoch),
              eq(
                aiPropertyTrendReports.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              eq(aiPropertyTrendReports.reportProfileVersion, input.reportProfileVersion),
              gt(aiPropertyTrendReports.expiresAt, now),
            ),
          )
          .orderBy(
            desc(aiPropertyTrendReports.dueLocalDate),
            desc(aiPropertyTrendReports.aggregateRevision),
          )
          .limit(1)
          .for('share')
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
        const fence = capabilityFence(report?.operationCapabilityFences)
        if (
          !report ||
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
          },
          generatedAtEpochMillis: report.generatedAt.getTime(),
        })
      })
    },
  }
}
