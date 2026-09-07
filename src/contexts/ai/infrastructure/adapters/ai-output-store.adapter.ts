import { and, desc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import type { ReviewId } from '#/shared/domain/ids'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
  CLOSED_TREND_SIGNAL_IDS,
} from '#/shared/ai-property-trend-contract'
import {
  aiOperations,
  aiExecutionControlHeads,
  aiPropertyAggregateHeads,
  aiPropertyProcessingProfiles,
  aiPropertyTrendOutcomes,
  aiPropertyTrendSchedules,
  aiReviewAnalyses,
  aiReviewAnalysisEnrollments,
  merchantAiEnablement,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-profile'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import type {
  AiOutputStorePort,
  AiTrendEvidence,
  AiTrendReportRead,
} from '../../application/ports/ai-output-store.port'
import type {
  ReviewAnalysisCurrentnessV1,
  ReviewAnalysisReadV1,
} from '../../domain/types'
import { addDays } from '../../application/local-date'

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

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REVIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLOSED_SIGNAL_ID_SET = new Set<string>(CLOSED_TREND_SIGNAL_IDS)

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000
}

function validWindowEvidence(
  value: unknown,
  startLocalDate: string,
  endLocalDate: string,
): boolean {
  const window = objectValue(value)
  const period = objectValue(window?.period)
  if (
    window === null ||
    period?.startLocalDate !== startLocalDate ||
    period.endLocalDate !== endLocalDate ||
    !boundedCount(window.textCandidateCount) ||
    !boundedCount(window.analyzedCount) ||
    !boundedCount(window.excludedCount) ||
    !boundedCount(window.starOnlyCount) ||
    !boundedCount(window.coverageBasisPoints) ||
    window.coverageBasisPoints > 10_000 ||
    window.analyzedCount > window.textCandidateCount ||
    window.excludedCount !== window.textCandidateCount - window.analyzedCount
  ) {
    return false
  }
  const expectedCoverage =
    window.textCandidateCount === 0
      ? 0
      : Number(
          (BigInt(window.analyzedCount) * 10_000n) / BigInt(window.textCandidateCount),
        )
  return window.coverageBasisPoints === expectedCoverage
}

/** The definition, render profile, and timezone the evidence was pinned to. */
function validTrendProfile(candidate: Partial<AiTrendEvidence>): boolean {
  return (
    candidate.definitionVersion === AI_PROPERTY_TREND_DEFINITION_VERSION &&
    candidate.definitionDigest === AI_PROPERTY_TREND_DEFINITION_DIGEST &&
    candidate.renderProfileVersion === AI_TREND_RENDER_PROFILE_VERSION &&
    candidate.renderProfileDigest === AI_TREND_RENDER_PROFILE_DIGEST &&
    typeof candidate.timezone === 'string' &&
    candidate.timezone.length >= 1 &&
    candidate.timezone.length <= 100
  )
}

function validModelLineage(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((lineage) => {
      const row = objectValue(lineage)
      return (
        row !== null &&
        typeof row.analysisProfileVersion === 'string' &&
        row.analysisProfileVersion.length > 0 &&
        typeof row.providerDeploymentProfileVersion === 'string' &&
        row.providerDeploymentProfileVersion.length > 0 &&
        typeof row.modelSnapshot === 'string' &&
        row.modelSnapshot.length > 0
      )
    })
  )
}

/**
 * Every selected signal must be a closed signal id whose counts sit inside the
 * two analyzed windows and whose stored magnitude reproduces exactly from those
 * counts — the number the merchant sees is never trusted from the row.
 */
function validSelectedSignal(
  signal: unknown,
  baselineAnalyzedCount: unknown,
  currentAnalyzedCount: unknown,
): boolean {
  const row = objectValue(signal)
  const baseline = objectValue(row?.baseline)
  const current = objectValue(row?.current)
  if (
    row === null ||
    typeof row.signalId !== 'string' ||
    !CLOSED_SIGNAL_ID_SET.has(row.signalId) ||
    baseline === null ||
    current === null ||
    !boundedCount(baseline.count) ||
    !boundedCount(baseline.total) ||
    !boundedCount(current.count) ||
    !boundedCount(current.total) ||
    baseline.count > baseline.total ||
    current.count > current.total ||
    !boundedCount(row.changeMagnitudeBasisPoints) ||
    row.changeMagnitudeBasisPoints > 10_000 ||
    baseline.total !== baselineAnalyzedCount ||
    current.total !== currentAnalyzedCount
  ) {
    return false
  }
  const denominator = BigInt(baseline.total) * BigInt(current.total)
  if (denominator === 0n) return false
  const delta =
    BigInt(current.count) * BigInt(baseline.total) -
    BigInt(baseline.count) * BigInt(current.total)
  const magnitude = delta < 0n ? -delta : delta
  return row.changeMagnitudeBasisPoints === Number((magnitude * 10_000n) / denominator)
}

function validSelectedSignals(candidate: Partial<AiTrendEvidence>): boolean {
  const signals = candidate.selectedSignals
  return (
    Array.isArray(signals) &&
    signals.length <= 4 &&
    signals.every((signal) =>
      validSelectedSignal(
        signal,
        candidate.baseline?.analyzedCount,
        candidate.current?.analyzedCount,
      ),
    ) &&
    new Set(signals.map((signal) => signal.signalId)).size === signals.length
  )
}

/** Local-date bounds of the two windows the evidence covers. */
type TrendWindowBounds = Readonly<{
  baselineStart: string
  baselineEnd: string
  currentStart: string
  currentEnd: string
}>

function validSupportingReview(supporting: unknown, bounds: TrendWindowBounds): boolean {
  const row = objectValue(supporting)
  if (
    row === null ||
    typeof row.reviewId !== 'string' ||
    !REVIEW_ID_PATTERN.test(row.reviewId) ||
    (row.window !== 'baseline' && row.window !== 'current') ||
    typeof row.localDate !== 'string' ||
    !LOCAL_DATE_PATTERN.test(row.localDate) ||
    typeof row.href !== 'string' ||
    !row.href.endsWith(`/reviews?reviewId=${row.reviewId}`)
  ) {
    return false
  }
  return row.window === 'baseline'
    ? row.localDate >= bounds.baselineStart && row.localDate <= bounds.baselineEnd
    : row.localDate >= bounds.currentStart && row.localDate <= bounds.currentEnd
}

function validSupportingReviews(
  candidate: Partial<AiTrendEvidence>,
  bounds: TrendWindowBounds,
): boolean {
  const supportingReviews = candidate.supportingReviews
  return (
    Array.isArray(supportingReviews) &&
    supportingReviews.length <= 20 &&
    supportingReviews.every((supporting) => validSupportingReview(supporting, bounds)) &&
    new Set(supportingReviews.map((supporting) => supporting.reviewId)).size ===
      supportingReviews.length
  )
}

function trendEvidence(value: unknown): AiTrendEvidence | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<AiTrendEvidence>
  if (
    typeof candidate.dataThroughLocalDate !== 'string' ||
    !LOCAL_DATE_PATTERN.test(candidate.dataThroughLocalDate)
  ) {
    return null
  }
  let bounds: TrendWindowBounds
  try {
    const currentStart = addDays(candidate.dataThroughLocalDate, -29)
    bounds = {
      baselineStart: addDays(currentStart, -30),
      baselineEnd: addDays(currentStart, -1),
      currentStart,
      currentEnd: candidate.dataThroughLocalDate,
    }
  } catch {
    return null
  }
  if (!validTrendProfile(candidate)) return null
  if (
    !validWindowEvidence(candidate.baseline, bounds.baselineStart, bounds.baselineEnd)
  ) {
    return null
  }
  if (!validWindowEvidence(candidate.current, bounds.currentStart, bounds.currentEnd)) {
    return null
  }
  if (!validModelLineage(candidate.modelLineage)) return null
  if (!validSelectedSignals(candidate)) return null
  if (!validSupportingReviews(candidate, bounds)) return null
  return candidate as AiTrendEvidence
}

type AiOutputCapability = 'review_analysis' | 'reply_drafting' | 'property_trends'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

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

/**
 * The governed "which reviews currently have a live analysis" query, shared by
 * every attribute an inbox filter can select on.
 *
 * Everything except the discriminating predicate is policy, and it is the same
 * policy in every case: the merchant authorization must be enabled and still
 * carry `review_analysis`; the analysis must sit on the authorization's own
 * lineage and epoch; the analysis, the review and the processing profile must
 * all agree on the source epoch; the review content must not have expired; and
 * the profile must still be active. Copying that per attribute is how the two
 * lists in this codebase drifted, so callers supply only what distinguishes
 * them.
 */
function findCurrentAnalysisReviewIds(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyIds?: readonly string[]
    reviewIds?: readonly string[]
    nowEpochMillis: number
  }>,
  discriminate: (now: Date) => readonly SQL<unknown>[],
): Promise<readonly ReviewId[]> {
  if (input.propertyIds?.length === 0) return Promise.resolve([])
  if (input.reviewIds?.length === 0) return Promise.resolve([])
  const now = new Date(input.nowEpochMillis)
  const conditions = [
    eq(aiReviewAnalyses.organizationId, input.organizationId),
    eq(aiReviewAnalyses.status, 'ready'),
    ...discriminate(now),
    eq(merchantAiEnablement.state, 'enabled'),
    sql`${merchantAiEnablement.capabilities} @> ARRAY['review_analysis']::text[]`,
    eq(
      aiReviewAnalyses.authorizationLineageId,
      merchantAiEnablement.authorizationLineageId,
    ),
    eq(aiReviewAnalyses.reviewAnalysisEpoch, merchantAiEnablement.reviewAnalysisEpoch),
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
  ]
  if (input.propertyIds) {
    conditions.push(inArray(aiReviewAnalyses.propertyId, [...input.propertyIds]))
  }
  if (input.reviewIds) {
    conditions.push(inArray(aiReviewAnalyses.reviewId, [...input.reviewIds]))
  }
  return db
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
        eq(aiPropertyProcessingProfiles.organizationId, aiReviewAnalyses.organizationId),
        eq(aiPropertyProcessingProfiles.propertyId, aiReviewAnalyses.propertyId),
      ),
    )
    .where(and(...conditions))
    .then((rows) => rows.map((row) => row.reviewId as ReviewId))
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
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
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
          input.analysisProfileVersion !== 'review-analysis-v1' ||
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
            replyBrandProfileVersion: aiOperations.replyBrandProfileVersion,
            replyBrandDisplayNameDigest: aiOperations.replyBrandDisplayNameDigest,
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
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
      if (input.attention.length === 0) return []
      return findCurrentAnalysisReviewIds(db, input, (now) => [
        inArray(aiReviewAnalyses.attention, [...input.attention]),
        gt(aiReviewAnalyses.expiresAt, now),
      ])
    },
    async findCurrentReviewIdsByCategory(input) {
      if (input.categories.length === 0) return []
      return findCurrentAnalysisReviewIds(db, input, (now) => [
        inArray(aiReviewAnalyses.primaryCategory, [...input.categories]),
        gt(aiReviewAnalyses.expiresAt, now),
      ])
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
            sourcePolicyId: aiOperations.sourcePolicyId,
            redactionProfileVersion: aiOperations.redactionProfileVersion,
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
          !aggregateHead ||
          reviewHead.headSequence !== input.terminalAnalysisSequence ||
          aggregateHead.terminalAnalysisSequence !== input.terminalAnalysisSequence ||
          aggregateHead.aggregateRevision !== input.aggregateRevision
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
          analysis.operationNoticeVersion === authorization.noticeVersion &&
          analysis.operationNoticeDigest === authorization.noticeDigest &&
          analysis.operationSourcePolicyId === authorization.sourcePolicyId &&
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
        /**
         * The analysis pipeline has consumed everything: the review head, the
         * event cursor, and the aggregate head all agree on the same sequence
         * and revision.
         */
        const analysisIsCaughtUp = () =>
          reviewHead !== undefined &&
          aggregateHead !== undefined &&
          reviewHead.headSequence === aggregateHead.terminalAnalysisSequence
        const caughtUp = analysisIsCaughtUp()

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
              aggregateHead?.terminalAnalysisSequence &&
            complete.aggregateRevision === aggregateHead?.aggregateRevision
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
