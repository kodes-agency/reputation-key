import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-profile'
import type { ReviewAnalysisNormalizationFlag } from '#/shared/analysis/normalizer'
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

export type AiProviderCompletion = Readonly<{
  expectedAttempt: number
  modelSnapshot: string
  inputTokens: number
  outputTokens: number
  completedAtEpochMillis: number
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
  /**
   * Writes the analysis root, its mentions and the sentence numbers each cites,
   * atomically with the operation it came from. False when a fence no longer holds.
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
      attention: readonly ReviewAttentionLevelV2[]
      nowEpochMillis: number
    }>,
  ): Promise<readonly ReviewId[]>

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
}>
