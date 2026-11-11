import { isCurrentAuthorizedEffect } from './ai-authorized-effect'
import { and, eq, gt, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import {
  aiOperations,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  merchantAiEnablement,
  reviews,
  reviewSourceContents,
} from '#/shared/db/schema'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-profile'
import { isAspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type { AiOutputStorePort } from '../../application/ports/ai-output-store.port'
import type { ReviewAnalysisReadV1 } from '../../domain/types'
import {
  insertAnalysisMentions,
  readReadyAnalysisV3,
} from './ai-review-analysis-mentions'
import {
  analysisMatchesProcessingProfile,
  findCurrentAnalysisReviewIds,
} from './ai-current-analysis-review-ids'
import { currentness } from './ai-review-analysis-currentness'
import { raiseUrgentAlert } from './ai-urgent-alert'
import { analysisNoticeStillCovers } from './ai-analysis-notice-coverage'

function capabilityFence(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const authorizedEffectOperationColumns = {
  state: aiOperations.state,
  executionAttempt: aiOperations.executionAttempt,
  command: aiOperations.command,
  capability: aiOperations.capability,
  organizationId: aiOperations.organizationId,
  propertyId: aiOperations.propertyId,
  sourceEpoch: aiOperations.sourceEpoch,
  authorizationLineageId: aiOperations.authorizationLineageId,
  noticeVersion: aiOperations.noticeVersion,
  noticeDigest: aiOperations.noticeDigest,
  propertyProfileVersion: aiOperations.propertyProfileVersion,
  sourcePolicyId: aiOperations.sourcePolicyId,
  redactionProfileVersion: aiOperations.redactionProfileVersion,
  operationProfileVersion: aiOperations.operationProfileVersion,
  capabilityRuntimeProfileVersion: aiOperations.capabilityRuntimeProfileVersion,
  providerDeploymentProfileVersion: aiOperations.providerDeploymentProfileVersion,
  capabilityFences: aiOperations.capabilityFences,
  globalControlId: aiOperations.globalControlId,
  globalControlGeneration: aiOperations.globalControlGeneration,
  providerControlId: aiOperations.providerControlId,
  providerControlGeneration: aiOperations.providerControlGeneration,
  capabilityControlId: aiOperations.capabilityControlId,
  capabilityControlGeneration: aiOperations.capabilityControlGeneration,
} as const

const reviewOperationColumns = {
  ...authorizedEffectOperationColumns,
  reviewId: aiOperations.reviewId,
  sourceRevision: aiOperations.sourceRevision,
  sourceDigest: aiOperations.sourceDigest,
  sourceByteCount: aiOperations.sourceByteCount,
} as const

const lockedReviewOperationColumns = {
  ...reviewOperationColumns,
  operationProfileVersion: aiOperations.operationProfileVersion,
  analysisSequence: aiOperations.analysisSequence,
  actorUserId: aiOperations.actorUserId,
  baseReplyStateRevision: aiOperations.baseReplyStateRevision,
  replyBrandProfileVersion: aiOperations.replyBrandProfileVersion,
  replyBrandDisplayNameDigest: aiOperations.replyBrandDisplayNameDigest,
} as const

async function lockReviewOperation(
  tx: Transaction,
  operationId: string,
  organizationId: string,
) {
  const [operation] = await tx
    .select(lockedReviewOperationColumns)
    .from(aiOperations)
    .where(
      and(
        eq(aiOperations.id, operationId),
        eq(aiOperations.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for('update')
  return operation
}

type AnalysisWriteFacts = Readonly<{
  operationId: string
  providerCompletion: Readonly<{
    expectedAttempt: number
    completedAtEpochMillis: number
  }>
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  authorizationLineageId: string
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
}>

/** The key every row of one analysis (root and mentions) is filed under. */
const analysisRootKey = (input: AnalysisWriteFacts) => ({
  organizationId: input.organizationId,
  propertyId: input.propertyId,
  reviewId: input.reviewId,
  sourceEpoch: input.sourceEpoch,
  sourceRevision: input.sourceRevision,
  analysisSequence: input.analysisSequence,
})

/**
 * The review's source as it stands now, share-locked: its epoch, revision and
 * sequence, the digest and size of the canonical source an operation read, when
 * its content expires and where its reply state is. Every provider result is
 * written only if this still matches what the operation was claimed on.
 */
async function readCurrentReviewSource(
  tx: Transaction,
  input: Readonly<{ organizationId: string; propertyId: string; reviewId: string }>,
) {
  const [source] = await tx
    .select({
      sourceEpoch: reviews.sourceEpoch,
      sourceRevision: reviews.sourceRevision,
      analysisSequence: reviews.analysisSequence,
      sourceDigest: reviewSourceContents.aiSourceDigest,
      sourceByteCount: reviewSourceContents.aiSourceByteLength,
      contentExpiresAt: reviewSourceContents.contentExpiresAt,
      replyStateRevision: reviews.replyStateRevision,
    })
    .from(reviews)
    .innerJoin(
      reviewSourceContents,
      and(
        eq(reviewSourceContents.reviewId, reviews.id),
        eq(reviewSourceContents.organizationId, reviews.organizationId),
        eq(reviewSourceContents.propertyId, reviews.propertyId),
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
    .for('share', { of: reviews })
  return source
}

/**
 * Whether the review's source is still the one the operation read: the same
 * epoch and revision, the same canonical source by digest and size, and content
 * that had not expired when the provider completed. The contract's own fence
 * (the analysis sequence, the reply state) is checked by the caller.
 */
function sourceHoldsOperation(
  source: NonNullable<Awaited<ReturnType<typeof readCurrentReviewSource>>>,
  operation: Readonly<{ sourceDigest: string | null; sourceByteCount: number | null }>,
  input: Readonly<{ sourceEpoch: number; sourceRevision: number }>,
  completedAt: Date,
): boolean {
  return (
    source.sourceEpoch === input.sourceEpoch &&
    source.sourceRevision === input.sourceRevision &&
    source.sourceDigest === operation.sourceDigest &&
    source.sourceByteCount === operation.sourceByteCount &&
    source.contentExpiresAt !== null &&
    source.contentExpiresAt > completedAt
  )
}

type LockedReviewOperation = NonNullable<Awaited<ReturnType<typeof lockReviewOperation>>>

type VerifiedAnalysisWrite = Readonly<{
  executionAttempt: number
  completedAt: Date
}>

/**
 * The fences every analysis write holds, whatever the contract: the operation is
 * the executing attempt the provider answered, for this review's source and
 * sequence, under this lineage and these epochs; the authorization, processing
 * profile and execution controls it was claimed under still stand; and the
 * review still has the source the operation read, unexpired when the provider
 * completed. `profileChecks` are the contract's own conditions, already evaluated.
 * The operation row stays locked until the transaction ends.
 */
async function verifyAnalysisWrite(
  tx: Transaction,
  input: AnalysisWriteFacts,
  profileChecks: (operation: LockedReviewOperation) => readonly boolean[],
): Promise<VerifiedAnalysisWrite | null> {
  const operation = await lockReviewOperation(tx, input.operationId, input.organizationId)
  const fence = capabilityFence(operation?.capabilityFences)
  if (
    !operation ||
    !fence ||
    ![
      operation.state === 'executing',
      operation.executionAttempt === input.providerCompletion.expectedAttempt,
      operation.command === 'analysis',
      operation.capability === 'review_analysis',
      operation.organizationId === input.organizationId,
      operation.propertyId === input.propertyId,
      operation.reviewId === input.reviewId,
      operation.sourceEpoch === input.sourceEpoch,
      operation.sourceRevision === input.sourceRevision,
      operation.analysisSequence === input.analysisSequence,
      operation.authorizationLineageId === input.authorizationLineageId,
      operation.propertyProfileVersion === input.propertyProfileVersion,
      ...profileChecks(operation),
      fence.capability === 'review_analysis',
      fence.reviewAnalysisEpoch === input.reviewAnalysisEpoch,
    ].every(Boolean) ||
    !(await isCurrentAuthorizedEffect(tx, {
      capability: 'review_analysis',
      operation,
      capabilityFence: fence,
    }))
  ) {
    return null
  }
  // The review's own analysis_sequence proves the source has not been
  // re-sequenced since the operation was reserved. The property head is a
  // per-property allocator (every pin or source change takes the next
  // number), so it equals this sequence only for the last review sequenced
  // — comparing against it discarded every other paid analysis.
  const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)
  const currentSource = await readCurrentReviewSource(tx, input)
  if (
    currentSource === undefined ||
    !sourceHoldsOperation(currentSource, operation, input, completedAt) ||
    currentSource.analysisSequence !== input.analysisSequence
  ) {
    return null
  }
  return { executionAttempt: operation.executionAttempt, completedAt }
}

type AnalysisRootContent = Readonly<{
  status: 'ready' | 'unavailable'
  unavailableReason: 'language_not_supported' | null
  sentiment: string | null
  primaryCategory: string | null
  issueLabel: string | null
  attention: string | null
  urgentReason: string | null
}>

/** Writes the analysis root once; false when the analysis already exists. */
async function insertAnalysisRoot(
  tx: Transaction,
  input: AnalysisWriteFacts &
    Readonly<{
      analysisProfileVersion: string
      generatedAtEpochMillis: number
      expiresAtEpochMillis: number
    }>,
  content: AnalysisRootContent,
): Promise<boolean> {
  const [inserted] = await tx
    .insert(aiReviewAnalyses)
    .values({
      ...analysisRootKey(input),
      operationId: input.operationId,
      authorizationLineageId: input.authorizationLineageId,
      reviewAnalysisEpoch: input.reviewAnalysisEpoch,
      propertyProfileVersion: input.propertyProfileVersion,
      analysisProfileVersion: input.analysisProfileVersion,
      ...content,
      generatedAt: new Date(input.generatedAtEpochMillis),
      expiresAt: new Date(input.expiresAtEpochMillis),
    })
    .onConflictDoNothing()
    .returning({ operationId: aiReviewAnalyses.operationId })
  return inserted !== undefined
}

/** Closes the operation the analysis came from, in the transaction that wrote it. */
async function completeAnalysisOperation(
  tx: Transaction,
  input: AnalysisWriteFacts,
  verified: VerifiedAnalysisWrite,
  record: Readonly<{ normalizationFlags?: string[]; droppedMentionCount?: number }>,
): Promise<void> {
  const completed = await tx
    .update(aiOperations)
    .set({
      state: 'succeeded_pending_delivery',
      updatedAt: verified.completedAt,
      ...record,
    })
    .where(
      and(
        eq(aiOperations.id, input.operationId),
        eq(aiOperations.organizationId, input.organizationId),
        eq(aiOperations.state, 'executing'),
        eq(aiOperations.executionAttempt, verified.executionAttempt),
      ),
    )
    .returning({ id: aiOperations.id })
  if (completed.length !== 1) throw new Error('AI analysis result commit conflict')
}

export const createAiOutputStoreAdapter = (
  db: Database,
  replyBrandProfiles?: Pick<
    PortalAiReplyBrandProfilePublicApi,
    'isCurrentAiReplyBrandProfile'
  >,
): AiOutputStorePort => {
  return {
    async storeAnalysisV3(input) {
      return db.transaction(async (tx) => {
        const verified = await verifyAnalysisWrite(tx, input, (operation) => [
          input.analysisProfileVersion === 'review-analysis-v3',
          operation.operationProfileVersion === 'review-analysis-v3',
        ])
        if (!verified) return false
        const inserted = await insertAnalysisRoot(tx, input, {
          status: 'ready',
          unavailableReason: null,
          sentiment: input.derivative.sentiment,
          primaryCategory: null,
          issueLabel: null,
          attention: input.derivative.attention,
          urgentReason: input.derivative.urgentReason,
        })
        if (!inserted) return false
        await insertAnalysisMentions(
          tx,
          analysisRootKey(input),
          input.derivative.mentions,
        )
        await completeAnalysisOperation(tx, input, verified, {
          normalizationFlags: [...input.derivative.normalization.flags],
          droppedMentionCount: input.derivative.normalization.droppedMentionCount,
        })
        if (input.derivative.attention === 'urgent') {
          await raiseUrgentAlert(tx, { ...input, occurredAt: verified.completedAt })
        }
        return true
      })
    },
    async settleEphemeralReply(input) {
      // fallow-ignore-next-line complexity -- complexity unchanged from main; the finding moved with earlier code (ADR 0074 refactor)
      return db.transaction(async (tx) => {
        const operation = await lockReviewOperation(
          tx,
          input.operationId,
          input.organizationId,
        )
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
          operation.replyBrandProfileVersion !==
            (input.replyBrandProfileVersion ?? null) ||
          operation.replyBrandDisplayNameDigest !==
            (input.replyBrandDisplayNameDigest ?? null) ||
          !replyProfilePairMatches(
            input.operationProfileVersion,
            input.replyProfileVersion,
          ) ||
          fence?.capability !== 'reply_drafting' ||
          fence.replyDraftingEpoch !== input.replyDraftingEpoch
        ) {
          return false
        }
        if (
          operation.replyBrandProfileVersion !== null &&
          operation.replyBrandDisplayNameDigest !== null &&
          (!replyBrandProfiles ||
            !(await replyBrandProfiles.isCurrentAiReplyBrandProfile(tx, {
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              version: operation.replyBrandProfileVersion,
              displayNameDigest: operation.replyBrandDisplayNameDigest,
            })))
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
        const currentSource = await readCurrentReviewSource(tx, input)
        if (
          currentSource === undefined ||
          !sourceHoldsOperation(currentSource, operation, input, completedAt) ||
          currentSource.replyStateRevision !== input.baseReplyStateRevision
        ) {
          return false
        }
        const completed = await tx
          .update(aiOperations)
          .set({ state: 'succeeded_pending_delivery', updatedAt: completedAt })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              eq(aiOperations.organizationId, input.organizationId),
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
      if (input.attention.length === 0) return []
      return findCurrentAnalysisReviewIds(db, input, (now) => [
        inArray(aiReviewAnalyses.attention, [...input.attention]),
        gt(aiReviewAnalyses.expiresAt, now),
      ])
    },

    async readAnalysisForDelivery(input, deliver) {
      // fallow-ignore-next-line complexity -- complexity unchanged from main; the finding moved with earlier code (ADR 0074 refactor)
      return db.transaction(async (tx) => {
        const deliverCurrent = (result: ReviewAnalysisReadV1) => deliver(result)
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

        if (
          !authorization ||
          ![
            authorization.state === 'enabled',
            authorization.authorizationLineageId === input.authorizationLineageId,
            authorization.capabilities.includes('review_analysis'),
            authorization.reviewAnalysisEpoch === input.reviewAnalysisEpoch,
            authorization.sourceEpoch === input.sourceEpoch,
            input.analysisSequence >= authorization.analysisStartSequence,
          ].every(Boolean)
        ) {
          return deliverCurrent({ status: 'disabled' })
        }

        const [profile] = await tx
          .select({
            profileVersion: aiPropertyProcessingProfiles.profileVersion,
            sourceEpoch: aiPropertyProcessingProfiles.sourceEpoch,
            lifecycleState: aiPropertyProcessingProfiles.lifecycleState,
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
          ![
            profile.lifecycleState === 'active',
            profile.profileVersion === input.propertyProfileVersion,
            profile.sourceEpoch === input.sourceEpoch,
          ].every(Boolean)
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
          .innerJoin(
            reviewSourceContents,
            and(
              eq(reviewSourceContents.reviewId, reviews.id),
              eq(reviewSourceContents.organizationId, reviews.organizationId),
              eq(reviewSourceContents.propertyId, reviews.propertyId),
            ),
          )
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
              gt(reviewSourceContents.contentExpiresAt, now),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !review ||
          ![
            review.sourceEpoch === input.sourceEpoch,
            review.sourceRevision === input.sourceRevision,
            review.analysisSequence === input.analysisSequence,
          ].every(Boolean)
        ) {
          return deliverCurrent({
            status: 'none',
            ...currentness(input),
          })
        }

        const [analysis] = await tx
          .select({
            status: aiReviewAnalyses.status,
            propertyProfileVersion: aiReviewAnalyses.propertyProfileVersion,
            sentiment: aiReviewAnalyses.sentiment,
            primaryCategory: aiReviewAnalyses.primaryCategory,
            attention: aiReviewAnalyses.attention,
            issueLabel: aiReviewAnalyses.issueLabel,
            urgentReason: aiReviewAnalyses.urgentReason,
            analysisProfileVersion: aiReviewAnalyses.analysisProfileVersion,
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
            operationNoticeVersion: aiOperations.noticeVersion,
            operationNoticeDigest: aiOperations.noticeDigest,
            operationSourcePolicyId: aiOperations.sourcePolicyId,
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
              analysisMatchesProcessingProfile(
                input.organizationId,
                input.propertyProfileVersion,
              ),
              gt(aiReviewAnalyses.expiresAt, now),
            ),
          )
          .limit(1)
          .for('share')

        const analysisFence = capabilityFence(analysis?.operationCapabilityFences)
        if (
          !analysis ||
          ![
            ['succeeded', 'succeeded_pending_delivery'].includes(analysis.operationState),
            analysis.operationCommand === 'analysis',
            analysis.operationCapability === 'review_analysis',
            analysis.operationOrganizationId === input.organizationId,
            analysis.operationPropertyId === input.propertyId,
            analysis.operationReviewId === input.reviewId,
            analysis.operationSourceEpoch === input.sourceEpoch,
            analysis.operationSourceRevision === input.sourceRevision,
            analysis.operationAnalysisSequence === input.analysisSequence,
            analysis.operationAuthorizationLineageId === input.authorizationLineageId,
            analysis.operationPropertyProfileVersion === analysis.propertyProfileVersion,
            analysisNoticeStillCovers(analysis, authorization),
            analysis.operationSourcePolicyId === authorization.sourcePolicyId,
            analysis.operationRedactionProfileVersion ===
              authorization.redactionProfileFamily,
            analysisFence?.capability === 'review_analysis',
            analysisFence?.reviewAnalysisEpoch === input.reviewAnalysisEpoch,
          ].every(Boolean)
        ) {
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
        if (analysis.analysisProfileVersion === 'review-analysis-v3') {
          return deliverCurrent(
            await readReadyAnalysisV3(tx, input, currentness(input), analysis),
          )
        }
        if (
          analysis.sentiment === null ||
          analysis.primaryCategory === null ||
          analysis.attention === null
        ) {
          throw new Error('Ready AI analysis row is incomplete')
        }
        if (
          !isAspectTaxonomyV1Id(analysis.primaryCategory) ||
          (analysis.issueLabel !== null && !isAiIssueLabel(analysis.issueLabel))
        ) {
          throw new Error('Ready AI analysis aspects or issue label are invalid')
        }
        return deliverCurrent({
          status: 'ready',
          sentiment: analysis.sentiment as 'positive' | 'neutral' | 'negative' | 'mixed',
          primaryCategory: analysis.primaryCategory as Extract<
            ReviewAnalysisReadV1,
            { status: 'ready' }
          >['primaryCategory'],
          aspects: [],
          issueLabel: analysis.issueLabel,
          attention: analysis.attention as 'urgent' | 'high' | 'medium' | 'low',
          generatedAtEpochMillis: analysis.generatedAt.getTime(),
          ...currentness(input),
        })
      })
    },
  }
}

function replyProfilePairMatches(operation: string, profile: string): boolean {
  return (
    (operation === 'reply-suggestion-v1' &&
      profile === AI_PERSONALIZED_REPLY_PROFILE_VERSION) ||
    (operation === 'reply-suggestion-v2' && profile === 'reply-draft-v4')
  )
}
