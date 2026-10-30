import { and, desc, eq, exists, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { readAggregateCoverageFence } from './ai-aggregate-coverage-fence'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import {
  aiOperations,
  aiExecutionControlHeads,
  aiPropertyProcessingProfiles,
  aiPropertyTrendOutcomes,
  aiPropertyTrendSchedules,
  aiReviewAnalyses,
  aiReviewAnalysisEnrollments,
  aiReviewAnalysisAspects,
  merchantAiEnablement,
  reviews,
} from '#/shared/db/schema'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-profile'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { isAspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type {
  AiOutputStorePort,
  AiTrendReportRead,
} from '../../application/ports/ai-output-store.port'
import type { ReviewAnalysisReadV1 } from '../../domain/types'
import {
  insertAnalysisMentions,
  readReadyAnalysisV3,
} from './ai-review-analysis-mentions'
import { findCurrentAnalysisReviewIds } from './ai-current-analysis-review-ids'
import { trendEvidence } from './ai-trend-evidence'
import { currentness } from './ai-review-analysis-currentness'
import { raiseUrgentAlert } from './ai-urgent-alert'

function capabilityFence(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

type AiOutputCapability = 'review_analysis' | 'reply_drafting' | 'property_trends'

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

type AuthorizedEffectOperation = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number | null
  authorizationLineageId: string | null
  noticeVersion: string | null
  noticeDigest: string | null
  propertyProfileVersion: number | null
  sourcePolicyId: string | null
  redactionProfileVersion: string | null
  globalControlId: string
  globalControlGeneration: number
  providerControlId: string
  providerControlGeneration: number
  capabilityControlId: string
  capabilityControlGeneration: number
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
    operation.sourceEpoch === null ||
    operation.authorizationLineageId === null ||
    operation.noticeVersion === null ||
    operation.noticeDigest === null ||
    operation.propertyProfileVersion === null ||
    operation.sourcePolicyId === null ||
    operation.redactionProfileVersion === null
  ) {
    return false
  }
  const runtime = getAiRuntimeCapability(input.capability)
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
      runtime.runtimeProfileVersion ||
    authorization.authorizedSourceEpoch !== operation.sourceEpoch ||
    authorization.noticeVersion !== operation.noticeVersion ||
    authorization.noticeDigest !== operation.noticeDigest ||
    authorization.sourcePolicyId !== operation.sourcePolicyId ||
    authorization.providerDeploymentProfileVersion !==
      AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion ||
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
    profile.profileVersion !== operation.propertyProfileVersion
  ) {
    return false
  }

  const providerScope = `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`
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
        providerScope,
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
      providerScope,
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

/** The key every row of one analysis (root, aspects, mentions) is filed under. */
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
      sourceDigest: reviews.aiSourceDigest,
      sourceByteCount: reviews.aiSourceByteLength,
      contentExpiresAt: reviews.contentExpiresAt,
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
    async storeAnalysis(input) {
      return db.transaction(async (tx) => {
        const verified = await verifyAnalysisWrite(tx, input, () => [
          input.analysisProfileVersion === 'review-analysis-v2',
          input.result.status !== 'ready' ||
            input.result.derivative.issueLabel === null ||
            isAiIssueLabel(input.result.derivative.issueLabel),
        ])
        if (!verified) return false

        const inserted = await insertAnalysisRoot(tx, input, {
          status: input.result.status,
          unavailableReason:
            input.result.status === 'unavailable' ? input.result.reason : null,
          sentiment:
            input.result.status === 'ready' ? input.result.derivative.sentiment : null,
          primaryCategory:
            input.result.status === 'ready'
              ? input.result.derivative.primaryCategory
              : null,
          issueLabel:
            input.result.status === 'ready' ? input.result.derivative.issueLabel : null,
          attention:
            input.result.status === 'ready' ? input.result.derivative.attention : null,
          urgentReason: null,
        })
        if (!inserted) return false
        if (input.result.status === 'ready') {
          await tx.insert(aiReviewAnalysisAspects).values(
            input.result.derivative.aspects.map((aspect) => ({
              ...analysisRootKey(input),
              aspect: aspect.aspect,
              polarity: aspect.polarity,
              intensity: aspect.intensity,
            })),
          )
        }
        await completeAnalysisOperation(tx, input, verified, {})
        return true
      })
    },
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
          input.operationProfileVersion !== 'reply-suggestion-v1' ||
          input.replyProfileVersion !== AI_PERSONALIZED_REPLY_PROFILE_VERSION ||
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
    async findCurrentReviewIdsByAspect(input) {
      if (
        input.aspects?.length === 0 ||
        input.polarities?.length === 0 ||
        (input.aspects === undefined && input.polarities === undefined)
      ) {
        return []
      }
      const mentionConditions = [
        eq(aiReviewAnalysisAspects.organizationId, aiReviewAnalyses.organizationId),
        eq(aiReviewAnalysisAspects.propertyId, aiReviewAnalyses.propertyId),
        eq(aiReviewAnalysisAspects.reviewId, aiReviewAnalyses.reviewId),
        eq(aiReviewAnalysisAspects.sourceEpoch, aiReviewAnalyses.sourceEpoch),
        eq(aiReviewAnalysisAspects.sourceRevision, aiReviewAnalyses.sourceRevision),
        eq(aiReviewAnalysisAspects.analysisSequence, aiReviewAnalyses.analysisSequence),
        ...(input.aspects
          ? [inArray(aiReviewAnalysisAspects.aspect, [...input.aspects])]
          : []),
        ...(input.polarities
          ? [inArray(aiReviewAnalysisAspects.polarity, [...input.polarities])]
          : []),
      ]
      return findCurrentAnalysisReviewIds(db, input, (now) => [
        exists(
          db
            .select({ one: sql`1` })
            .from(aiReviewAnalysisAspects)
            .where(and(...mentionConditions)),
        ),
        gt(aiReviewAnalyses.expiresAt, now),
      ])
    },

    async storeTrendReport(input) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({
            ...authorizedEffectOperationColumns,
            dueLocalDate: aiOperations.dueLocalDate,
            terminalAnalysisSequence: aiOperations.terminalAnalysisSequence,
            aggregateRevision: aiOperations.aggregateRevision,
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
          input.reportProfileVersion !== 'property-trend-v1' ||
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
        const [coverage] = await tx
          .select({
            analysisStartSequence: merchantAiEnablement.analysisStartSequence,
          })
          .from(merchantAiEnablement)
          .where(
            and(
              eq(merchantAiEnablement.organizationId, input.organizationId),
              eq(merchantAiEnablement.propertyId, input.propertyId),
              eq(merchantAiEnablement.authorizedSourceEpoch, input.sourceEpoch),
              eq(merchantAiEnablement.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const aggregateCoverage = coverage
          ? await readAggregateCoverageFence(tx, input, coverage.analysisStartSequence)
          : undefined
        if (
          !coverage ||
          !aggregateCoverage ||
          aggregateCoverage.settledCount !== aggregateCoverage.expectedSettlementCount ||
          aggregateCoverage.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          aggregateCoverage.aggregateRevision !== input.aggregateRevision
        ) {
          return false
        }
        const completedAt = new Date(input.providerCompletion.completedAtEpochMillis)

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
            confidenceBasisPoints: input.report.changeMagnitudeBasisPoints,
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
              eq(aiReviewAnalyses.propertyProfileVersion, input.propertyProfileVersion),
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
            analysis.operationPropertyProfileVersion === input.propertyProfileVersion,
            analysis.operationNoticeVersion === authorization.noticeVersion,
            analysis.operationNoticeDigest === authorization.noticeDigest,
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
        const aspects = await tx
          .select({
            aspect: aiReviewAnalysisAspects.aspect,
            polarity: aiReviewAnalysisAspects.polarity,
            intensity: aiReviewAnalysisAspects.intensity,
          })
          .from(aiReviewAnalysisAspects)
          .where(
            and(
              eq(aiReviewAnalysisAspects.organizationId, input.organizationId),
              eq(aiReviewAnalysisAspects.propertyId, input.propertyId),
              eq(aiReviewAnalysisAspects.reviewId, input.reviewId),
              eq(aiReviewAnalysisAspects.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalysisAspects.sourceRevision, input.sourceRevision),
              eq(aiReviewAnalysisAspects.analysisSequence, input.analysisSequence),
            ),
          )
          .orderBy(aiReviewAnalysisAspects.aspect)
        if (
          !isAspectTaxonomyV1Id(analysis.primaryCategory) ||
          (aspects.length < 1 &&
            analysis.analysisProfileVersion !== 'review-analysis-v1') ||
          aspects.length > 5 ||
          aspects.some(({ aspect }) => !isAspectTaxonomyV1Id(aspect)) ||
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
          aspects: aspects as Extract<
            ReviewAnalysisReadV1,
            { status: 'ready' }
          >['aspects'],
          issueLabel: analysis.issueLabel,
          attention: analysis.attention as 'urgent' | 'high' | 'medium' | 'low',
          generatedAtEpochMillis: analysis.generatedAt.getTime(),
          ...currentness(input),
        })
      })
    },

    async readTrendReportForDelivery(input, deliver) {
      return db.transaction(async (tx) => {
        const deliverCurrent = (result: AiTrendReportRead) => deliver(result)
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
            authorizationStateVersion: merchantAiEnablement.stateVersion,
            analysisStartSequence: merchantAiEnablement.analysisStartSequence,
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
        /** Trend delivery needs an enabled grant pinned to this read's epochs. */
        const authorizationCoversTrends = () =>
          authorization?.state === 'enabled' &&
          authorization.capabilities.includes('property_trends') &&
          authorization.reviewAnalysisEpoch === input.reviewAnalysisEpoch &&
          authorization.propertyTrendsEpoch === input.propertyTrendsEpoch &&
          authorization.sourceEpoch === input.sourceEpoch
        const authorizationLineageId = authorization?.authorizationLineageId ?? null
        if (authorizationLineageId === null || !authorizationCoversTrends()) {
          return deliverCurrent({ status: 'disabled' })
        }

        const [enrollment] = await tx
          .select({ state: aiReviewAnalysisEnrollments.state })
          .from(aiReviewAnalysisEnrollments)
          .where(
            and(
              eq(aiReviewAnalysisEnrollments.organizationId, input.organizationId),
              eq(aiReviewAnalysisEnrollments.propertyId, input.propertyId),
              eq(
                aiReviewAnalysisEnrollments.authorizationLineageId,
                authorizationLineageId,
              ),
              eq(
                aiReviewAnalysisEnrollments.authorizationStateVersion,
                authorization.authorizationStateVersion,
              ),
              eq(aiReviewAnalysisEnrollments.sourceEpoch, input.sourceEpoch),
              eq(
                aiReviewAnalysisEnrollments.reviewAnalysisEpoch,
                input.reviewAnalysisEpoch,
              ),
              eq(
                aiReviewAnalysisEnrollments.analysisStartSequence,
                authorization.analysisStartSequence,
              ),
            ),
          )
          .limit(1)
          .for('share')
        if (enrollment?.state !== 'caught_up') {
          return deliverCurrent(preparing())
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
        /** The property profile must still be the exact one this read pins. */
        const profileMatchesRead = () =>
          Boolean(profile) &&
          profile.lifecycleState === 'active' &&
          profile.profileVersion === input.propertyProfileVersion &&
          profile.sourceEpoch === input.sourceEpoch
        if (!profileMatchesRead()) {
          return deliverCurrent(preparing())
        }

        const aggregateCoverage = await readAggregateCoverageFence(
          tx,
          input,
          authorization.analysisStartSequence,
        )
        /**
         * The aggregate is complete only when every sequence allocated after
         * authorization was transactionally settled. The terminal sequence is
         * a max-watermark and can move ahead while lower sequences remain open.
         */
        const caughtUp =
          aggregateCoverage !== undefined &&
          aggregateCoverage.settledCount === aggregateCoverage.expectedSettlementCount

        const now = new Date(input.nowEpochMillis)
        const reports = await tx
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
            definitionVersion: aiPropertyTrendOutcomes.definitionVersion,
            definitionDigest: aiPropertyTrendOutcomes.definitionDigest,
            evidence: aiPropertyTrendOutcomes.evidence,
            operationId: aiPropertyTrendOutcomes.operationId,
            providerSelectionRecordedAt:
              aiPropertyTrendOutcomes.providerSelectionRecordedAt,
            generatedAt: aiPropertyTrendOutcomes.recordedAt,
          })
          .from(aiPropertyTrendOutcomes)
          .innerJoin(
            aiPropertyTrendSchedules,
            eq(aiPropertyTrendSchedules.id, aiPropertyTrendOutcomes.scheduleId),
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
                aiPropertyTrendOutcomes.definitionVersion,
                AI_PROPERTY_TREND_DEFINITION_VERSION,
              ),
              eq(
                aiPropertyTrendOutcomes.definitionDigest,
                AI_PROPERTY_TREND_DEFINITION_DIGEST,
              ),
              isNotNull(aiPropertyTrendOutcomes.evidence),
              isNull(aiPropertyTrendOutcomes.operationId),
              isNull(aiPropertyTrendOutcomes.providerSelectionRecordedAt),
              gt(aiPropertyTrendOutcomes.expiresAt, now),
            ),
          )
          .orderBy(
            desc(aiPropertyTrendSchedules.dueLocalDate),
            desc(aiPropertyTrendSchedules.aggregateRevision),
          )
          .limit(32)
        const latestComplete = reports.find((report) =>
          ['ready', 'insufficient_data', 'no_material_change'].includes(
            report.disposition,
          ),
        )
        const latestUpdating = reports.find((report) => report.disposition === 'updating')
        const updatingEvidence = trendEvidence(latestUpdating?.evidence)
        if (!latestComplete) {
          if (latestUpdating && updatingEvidence) {
            return deliverCurrent({
              status: 'updating',
              sourceEpoch: input.sourceEpoch,
              reviewAnalysisEpoch: input.reviewAnalysisEpoch,
              propertyTrendsEpoch: input.propertyTrendsEpoch,
              propertyProfileVersion: input.propertyProfileVersion,
              evidence: updatingEvidence,
            })
          }
          if (!caughtUp) {
            return deliverCurrent({
              status: 'updating',
              sourceEpoch: input.sourceEpoch,
              reviewAnalysisEpoch: input.reviewAnalysisEpoch,
              propertyTrendsEpoch: input.propertyTrendsEpoch,
              propertyProfileVersion: input.propertyProfileVersion,
            })
          }
          return deliverCurrent(preparing())
        }
        const evidence = trendEvidence(latestComplete.evidence)
        if (evidence === null) return deliverCurrent(preparing())
        /**
         * A completed report is stale when the pipeline has moved past the
         * sequence it was computed from, or when a newer report is already
         * being produced for the same or a later due date.
         */
        const reportIsStale = (
          complete: NonNullable<typeof latestComplete>,
          candidate: typeof latestUpdating,
        ) => {
          const isCurrent =
            caughtUp &&
            complete.terminalAnalysisSequence ===
              aggregateCoverage?.terminalAnalysisSequence &&
            complete.aggregateRevision === aggregateCoverage?.aggregateRevision
          const candidateIsNewer =
            candidate !== undefined &&
            (candidate.dueLocalDate > complete.dueLocalDate ||
              (candidate.dueLocalDate === complete.dueLocalDate &&
                candidate.aggregateRevision > complete.aggregateRevision))
          return !isCurrent || candidateIsNewer
        }
        /**
         * A `ready` disposition still has to carry a complete, current-profile
         * render; anything missing means the row is not deliverable yet.
         */
        const readyRead = (
          complete: NonNullable<typeof latestComplete>,
          updating: boolean,
        ): AiTrendReportRead => {
          if (
            complete.disposition !== 'ready' ||
            complete.renderProfileVersion !== AI_TREND_RENDER_PROFILE_VERSION ||
            complete.renderProfileDigest !== AI_TREND_RENDER_PROFILE_DIGEST ||
            complete.signalKey === null ||
            complete.direction === null ||
            complete.confidenceBasisPoints === null ||
            complete.supportingReviewCount === null ||
            complete.headline === null ||
            !Array.isArray(complete.sentences) ||
            complete.summary === null
          ) {
            return preparing()
          }
          return {
            status: 'ready',
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyTrendsEpoch: input.propertyTrendsEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            dueLocalDate: complete.dueLocalDate,
            terminalAnalysisSequence: complete.terminalAnalysisSequence,
            aggregateRevision: complete.aggregateRevision,
            reportProfileVersion: input.reportProfileVersion,
            report: {
              signalKey: complete.signalKey,
              direction: complete.direction as 'improving' | 'stable' | 'declining',
              changeMagnitudeBasisPoints: complete.confidenceBasisPoints,
              supportingReviewCount: complete.supportingReviewCount,
              headline: complete.headline as
                | 'Review signals improved'
                | 'Review signals need attention'
                | 'Notable review changes',
              sentences: complete.sentences as readonly string[],
              summary: complete.summary,
            },
            evidence,
            updating,
            generatedAtEpochMillis: complete.generatedAt.getTime(),
          }
        }
        const updating = reportIsStale(latestComplete, latestUpdating)
        if (
          latestComplete.disposition === 'insufficient_data' ||
          latestComplete.disposition === 'no_material_change'
        ) {
          return deliverCurrent({
            status: latestComplete.disposition,
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyTrendsEpoch: input.propertyTrendsEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            dueLocalDate: latestComplete.dueLocalDate,
            terminalAnalysisSequence: latestComplete.terminalAnalysisSequence,
            aggregateRevision: latestComplete.aggregateRevision,
            evidence,
            updating,
          })
        }
        return deliverCurrent(readyRead(latestComplete, updating))
      })
    },
  }
}
