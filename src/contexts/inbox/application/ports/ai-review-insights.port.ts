import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'

export type ReviewAttention = 'urgent' | 'high' | 'medium' | 'low'
export type ReviewAspect = AspectTaxonomyV1Id
export type ReviewAspectPolarity = AspectPolarityV1
export type ReviewAnalysisAspect = Readonly<{
  aspect: ReviewAspect
  polarity: ReviewAspectPolarity
  intensity: number
}>

export type InboxReviewAnalysis =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>
  | Readonly<{
      status: 'ready'
      sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
      aspects: readonly ReviewAnalysisAspect[]
      primaryCategory: ReviewAspect
      attention: ReviewAttention
      issueLabel?: string
      generatedAtEpochMillis: number
    }>

export type AiReviewInsightsPort = Readonly<{
  readCurrentReviewAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      actorUserId: UserId
    }>,
  ): Promise<InboxReviewAnalysis>
  findCurrentReviewIdsByAttention(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      /** Optional page-bounded review set used for list-row enrichment. */
      reviewIds?: readonly ReviewId[]
      attention: readonly ReviewAttention[]
    }>,
  ): Promise<readonly ReviewId[]>
  /** Review ids whose current analysis contains a matching aspect mention.
   * When both arrays are supplied, a single mention must satisfy both. */
  findCurrentReviewIdsByAspect(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      aspects?: readonly ReviewAspect[]
      polarities?: readonly ReviewAspectPolarity[]
    }>,
  ): Promise<readonly ReviewId[]>
}>
