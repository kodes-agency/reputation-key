import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { StarRating } from '../../domain/types'

export type AiReviewObservation = Readonly<{
  kind: 'review'
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  text: string | null
  rating: StarRating
  languageCode: string | null
  reviewedAtEpochMillis: number
  contentExpiresAtEpochMillis: number
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

export type AiReviewSourceDenial =
  | 'not_found'
  | 'expired'
  | 'source_epoch_changed'
  | 'source_revision_changed'
  | 'analysis_sequence_changed'
  | 'source_too_large'
  | 'policy_unavailable'

export type AiReviewSourceExpectation =
  | Readonly<{
      kind: 'analysis'
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
    }>
  | Readonly<{
      kind: 'reply'
      sourceEpoch: number
      sourceRevision: number
    }>

export type AiReviewSourceRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  expected: AiReviewSourceExpectation
}>

export type AiReviewSourceResult =
  | Readonly<{ status: 'available'; observation: AiReviewObservation }>
  | Readonly<{ status: AiReviewSourceDenial }>

/**
 * Content-free current Review identity used by foreign contexts before they
 * authorize or bind work to a source revision. Review remains the sole owner
 * of the repository query and deliberately omits guest-authored content.
 */
export type AiReviewCurrentSource = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

export type AiReviewCurrentSourceResult =
  | Readonly<{ status: 'available'; source: AiReviewCurrentSource }>
  | Readonly<{ status: 'not_found' }>

export type AiTrendPopulationReview = Readonly<{
  reviewId: ReviewId
  sourceRevision: number
  analysisSequence: number
  localDate: string
  hasText: boolean
}>

export type AiTrendPopulationRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  timezone: string
  calendarProfileVersion: 'property-calendar-v1'
  startLocalDate: string
  endLocalDate: string
  /** Hard query ceiling. A full result is strictly smaller than this value. */
  limit: number
}>

export type AiTrendPopulationResult =
  | Readonly<{
      status: 'complete'
      reviews: readonly AiTrendPopulationReview[]
    }>
  | Readonly<{ status: 'limit_exceeded' | 'policy_unavailable' }>

export type AiReviewSourcePort = Readonly<{
  readCurrentSource(
    input: Readonly<{
      organizationId: OrganizationId
      reviewId: ReviewId
    }>,
  ): Promise<AiReviewCurrentSourceResult>
  readForAi(input: AiReviewSourceRequest): Promise<AiReviewSourceResult>
  readTrendPopulation(input: AiTrendPopulationRequest): Promise<AiTrendPopulationResult>
  readReplyStateRevision(
    input: Readonly<{
      organizationId: OrganizationId
      reviewId: ReviewId
    }>,
  ): Promise<number>
  assertCurrent(
    input: AiReviewSourceRequest,
  ): Promise<Readonly<{ status: 'current' | AiReviewSourceDenial }>>
}>
