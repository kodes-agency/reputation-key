import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-profile'
import type { ReviewAnalysisNormalizationFlag } from '#/shared/review-analysis-v3-normalizer'
import type {
  ReviewAttentionLevelV2,
  ReviewSentimentV3,
  ReviewUrgentReasonV3,
} from '#/shared/review-analysis-v3'
import type {
  AiOperationId,
  ReviewAnalysisMentionV3,
  ReviewAnalysisReadV1,
} from '../../domain/types'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'

export type AiAnalysisAspect = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  intensity: number
}>

export type AiAnalysisDerivative = Readonly<{
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  primaryCategory: AspectTaxonomyV1Id
  attention: 'urgent' | 'high' | 'medium' | 'low'
  aspects: readonly AiAnalysisAspect[]
  issueLabel: string | null
}>

/**
 * What a v3 analysis stores (contract section 3.1): the normalized answer and
 * the attention derived from it, never the provider's own response. `normalization`
 * is what the normalizer did to get there, as the closed content-free flags and
 * how many mentions it dropped, kept on the operation for audit.
 */
export type AiAnalysisDerivativeV3 = Readonly<{
  sentiment: ReviewSentimentV3
  attention: ReviewAttentionLevelV2
  urgentReason: ReviewUrgentReasonV3 | null
  mentions: readonly ReviewAnalysisMentionV3[]
  normalization: Readonly<{
    flags: readonly ReviewAnalysisNormalizationFlag[]
    droppedMentionCount: number
  }>
}>

export type AiAnalysisResult =
  | Readonly<{ status: 'ready'; derivative: AiAnalysisDerivative }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>

export type AiTrendWindowEvidence = Readonly<{
  period: Readonly<{ startLocalDate: string; endLocalDate: string }>
  textCandidateCount: number
  analyzedCount: number
  /** Text-bearing candidates absent from the current successful analysis set. */
  excludedCount: number
  /** Rating-only Reviews; deliberately outside the coverage denominator. */
  starOnlyCount: number
  coverageBasisPoints: number
}>

export type AiTrendModelLineage = Readonly<{
  analysisProfileVersion: string
  providerDeploymentProfileVersion: string
  modelSnapshot: string
}>

export type AiTrendSelectedSignalEvidence = Readonly<{
  signalId: string
  baseline: Readonly<{ count: number; total: number }>
  current: Readonly<{ count: number; total: number }>
  changeMagnitudeBasisPoints: number
}>

export type AiTrendSupportingReview = Readonly<{
  reviewId: ReviewId
  window: 'baseline' | 'current'
  localDate: string
  /**
   * Retained because the persisted evidence format requires it; it is not a
   * working route. Delivery resolves the Inbox Item that opens the Review
   * instead (`withSupportingReviewItems`).
   */
  href: string
}>

/**
 * Stored evidence carries `AiTrendSupportingReview`; what reaches a manager
 * carries the delivery view of it (`AiTrendReportView`).
 */
export type AiTrendEvidence<SupportingReview = AiTrendSupportingReview> = Readonly<{
  definitionVersion: string
  definitionDigest: string
  renderProfileVersion: string
  renderProfileDigest: string
  timezone: string
  dataThroughLocalDate: string
  baseline: AiTrendWindowEvidence
  current: AiTrendWindowEvidence
  modelLineage: readonly AiTrendModelLineage[]
  selectedSignals: readonly AiTrendSelectedSignalEvidence[]
  supportingReviews: readonly SupportingReview[]
}>

export type AiTrendReport = Readonly<{
  signalKey: string
  /**
   * Dominant polarity of the selected signals. `stable` means no polarised
   * signal was selected (neutral-sentiment/category shifts are material but
   * directionless) — it never means "no material change".
   */
  direction: 'improving' | 'stable' | 'declining'
  /**
   * Absolute change in the leading signal's share between the baseline and
   * current windows, in basis points (10000 = 100 percentage points, saturating).
   *
   * This is a CHANGE MAGNITUDE, never a confidence, probability or accuracy: the
   * name matches the historical `confidence_basis_points` column only. Surfaces
   * must label it as a change size.
   */
  changeMagnitudeBasisPoints: number
  supportingReviewCount: number
  headline?:
    'Review signals improved' | 'Review signals need attention' | 'Notable review changes'
  sentences?: readonly string[]
  summary?: string
}>
export type AiProviderCompletion = Readonly<{
  expectedAttempt: number
  modelSnapshot: string
  inputTokens: number
  outputTokens: number
  completedAtEpochMillis: number
}>

export type AiTrendReportRead<SupportingReview = AiTrendSupportingReview> =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{
      status: 'preparing'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
    }>
  | Readonly<{
      status: 'updating'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      evidence?: AiTrendEvidence<SupportingReview>
    }>
  | Readonly<{
      status: 'insufficient_data' | 'no_material_change'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
      evidence: AiTrendEvidence<SupportingReview>
      updating: boolean
    }>
  | Readonly<{
      status: 'ready'
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
      reportProfileVersion: string
      report: AiTrendReport
      evidence: AiTrendEvidence<SupportingReview>
      updating: boolean
      generatedAtEpochMillis: number
    }>

/** What every analysis write carries, whichever contract produced the answer. */
type AiAnalysisWrite = Readonly<{
  operationId: AiOperationId
  providerCompletion: AiProviderCompletion
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  authorizationLineageId: string
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  analysisProfileVersion: string
  generatedAtEpochMillis: number
  expiresAtEpochMillis: number
}>

export type AiOutputStorePort = Readonly<{
  storeAnalysis(
    input: AiAnalysisWrite & Readonly<{ result: AiAnalysisResult }>,
  ): Promise<boolean>

  /**
   * The v3 counterpart of `storeAnalysis`: the same fences and the same atomic
   * commit with the operation, writing the analysis root, its mentions and the
   * sentence numbers each cites. False when a fence no longer holds.
   */
  storeAnalysisV3(
    input: AiAnalysisWrite & Readonly<{ derivative: AiAnalysisDerivativeV3 }>,
  ): Promise<boolean>

  /**
   * Commits provider accounting for a browser-ephemeral reply suggestion.
   * Draft content and provider grounding are deliberately not persisted here.
   * The distinct output profile is checked without changing the stable
   * operation wrapper used by existing rows.
   */
  settleEphemeralReply(
    input: Readonly<{
      operationId: AiOperationId
      providerCompletion: AiProviderCompletion
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      actorUserId: UserId
      sourceEpoch: number
      sourceRevision: number
      baseReplyStateRevision: number
      authorizationLineageId: string
      replyDraftingEpoch: number
      propertyProfileVersion: number
      /** Missing only for pre-grounding operations retained during rollout. */
      replyBrandProfileVersion?: number
      /** Missing only for pre-grounding operations retained during rollout. */
      replyBrandDisplayNameDigest?: string
      operationProfileVersion: 'reply-suggestion-v1' | 'reply-suggestion-v2'
      replyProfileVersion: typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION | 'reply-draft-v4'
    }>,
  ): Promise<boolean>
  findCurrentReviewIdsByAttention(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      reviewIds?: readonly ReviewId[]
      attention: readonly AiAnalysisDerivative['attention'][]
      nowEpochMillis: number
    }>,
  ): Promise<readonly ReviewId[]>
  findCurrentReviewIdsByAspect(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      aspects?: readonly AiAnalysisAspect['aspect'][]
      polarities?: readonly AiAnalysisAspect['polarity'][]
      nowEpochMillis: number
    }>,
  ): Promise<readonly ReviewId[]>

  storeTrendReport(
    input: Readonly<{
      scheduleId: string
      operationId: AiOperationId
      organizationId: OrganizationId
      providerCompletion: AiProviderCompletion
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
      reportProfileVersion: string
      selectedSignalIds: readonly string[]
      report: AiTrendReport
      generatedAtEpochMillis: number
      expiresAtEpochMillis: number
    }>,
  ): Promise<boolean>

  readAnalysisForDelivery<T>(
    input: Readonly<{
      organizationId: OrganizationId
      actorUserId: UserId
      propertyId: PropertyId
      reviewId: ReviewId
      authorizationLineageId: string
      reviewAnalysisEpoch: number
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      propertyProfileVersion: number
      analysisProfileVersion: string
      nowEpochMillis: number
    }>,
    deliver: (result: ReviewAnalysisReadV1) => Promise<T>,
  ): Promise<T>

  readTrendReportForDelivery<T>(
    input: Readonly<{
      organizationId: OrganizationId
      actorUserId: UserId
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
      propertyProfileVersion: number
      reportProfileVersion: string
      nowEpochMillis: number
    }>,
    deliver: (result: AiTrendReportRead) => Promise<T>,
  ): Promise<T>
}>
