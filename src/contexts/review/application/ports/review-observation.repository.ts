import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { StarRating } from '../../domain/types'
import type { ReviewMaterialComparison } from '../../domain/material-review-revision'

export type ReviewObservationComparison =
  'backfilled_unverified' | ReviewMaterialComparison | 'out_of_order_ignored'

export type ReviewSourceObservation = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  observationSequence: number
  materialRevision: number
  observedAt: Date
  contentExpiresAt: Date
  sourceDigest: string | null
  normalizationVersion: string
  normalizedDigest: string | null
  comparison: ReviewObservationComparison
  rating: StarRating | null
  originalText: string | null
  contentState: 'active' | 'source_expired' | 'provider_deleted'
  contentErasedAt: Date | null
}>

export type MaterialReviewRevision = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  revision: number
  normalizationVersion: string
  sourceDigest: string | null
  normalizedDigest: string | null
  rating: StarRating | null
  normalizedText: string | null
  contentState: 'active' | 'source_expired' | 'provider_deleted'
  contentErasedAt: Date | null
  createdAt: Date
}>

/** Tenant-scoped history reads for Review-owned consumers and migration parity. */
export type ReviewObservationRepository = Readonly<{
  findObservations(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<readonly ReviewSourceObservation[]>
  findMaterialRevisions(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<readonly MaterialReviewRevision[]>
}>
