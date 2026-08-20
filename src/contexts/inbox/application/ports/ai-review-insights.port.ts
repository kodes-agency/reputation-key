import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import { AI_PRIMARY_CATEGORIES } from '#/shared/openai-route-output-schemas'

export type ReviewAttention = 'urgent' | 'high' | 'medium' | 'low'

/** The canonical AI primary-category union — derived from the one catalogue the
 *  provider output schema is built from, never re-typed here. */
export type ReviewCategory = (typeof AI_PRIMARY_CATEGORIES)[number]

export type InboxReviewAnalysis =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>
  | Readonly<{
      status: 'ready'
      sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
      primaryCategory: ReviewCategory
      attention: ReviewAttention
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
      attention: readonly ReviewAttention[]
    }>,
  ): Promise<readonly ReviewId[]>
  /** Review ids whose *current* analysis carries one of `categories`. An empty
   *  result means "no review matches" — never "no filter" (see the attention
   *  finder above; both are gated by the AI context's capability/epoch rules). */
  findCurrentReviewIdsByCategory(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      categories: readonly ReviewCategory[]
    }>,
  ): Promise<readonly ReviewId[]>
}>
