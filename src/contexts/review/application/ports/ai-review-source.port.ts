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

export type AiReviewSourcePort = Readonly<{
  readForAi(input: AiReviewSourceRequest): Promise<AiReviewSourceResult>
  assertCurrent(
    input: AiReviewSourceRequest,
  ): Promise<Readonly<{ status: 'current' | AiReviewSourceDenial }>>
}>
