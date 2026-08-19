import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'

export type ReviewAttention = 'urgent' | 'high' | 'medium' | 'low'

export type InboxReviewAnalysis =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>
  | Readonly<{
      status: 'ready'
      sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
      primaryCategory:
        | 'service'
        | 'staff'
        | 'quality'
        | 'value'
        | 'cleanliness'
        | 'wait_time'
        | 'atmosphere'
        | 'location'
        | 'accessibility'
        | 'other'
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
}>
