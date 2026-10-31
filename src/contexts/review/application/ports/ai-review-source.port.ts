import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { StarRating } from '../../domain/types'

/**
 * One sentence of the review as a v3 analysis reads it. `number` is its place in
 * the RAW text under `review-sentences-v1`, the numbering the live display uses
 * to underline the evidence a stored pointer names; `text` is that sentence
 * canonicalized and identity-minimized like the whole `text`, and may be empty.
 */
export type AiReviewSentence = Readonly<{ number: number; text: string }>

export type AiReviewObservation = Readonly<{
  kind: 'review'
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  text: string | null
  /**
   * Present only when the read asked for it (`AiReviewSourceReadRequest`): the
   * same review, cut into the numbered sentences a v3 request carries. Never
   * stored by AI, logged or sent anywhere but the provider call.
   */
  sentences?: readonly AiReviewSentence[]
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

/** What `readForAi` is asked for: the request, and optionally the numbered sentences. */
export type AiReviewSourceReadRequest = AiReviewSourceRequest &
  Readonly<{
    /**
     * Also return `observation.sentences`. A review with more sentences than an
     * evidence request carries is `source_too_large`, like one with too much text.
     */
    sentences?: true
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
  rating: StarRating
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
  /** Ask the bounded read to report whether eligible evidence predates its start. */
  detectEvidenceBeforeStart: boolean
}>

export type AiTrendPopulationResult =
  | Readonly<{
      status: 'complete'
      reviews: readonly AiTrendPopulationReview[]
      hasEvidenceBeforeStart: boolean
    }>
  | Readonly<{ status: 'limit_exceeded' | 'policy_unavailable' }>

export type AiReviewSourcePort = Readonly<{
  hasCurrentReply(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
    }>,
  ): Promise<boolean>

  readCurrentSource(
    input: Readonly<{
      organizationId: OrganizationId
      reviewId: ReviewId
    }>,
  ): Promise<AiReviewCurrentSourceResult>
  readForAi(input: AiReviewSourceReadRequest): Promise<AiReviewSourceResult>
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
