// Inbox context — cross-context lookup SOURCES (BQC-5.2).
//
// Narrow structural types for the foreign-owned read pieces the inbox build
// adapts into its lookup ports. The composition root supplies the owning
// contexts' repos / public APIs; inbox never imports their infrastructure —
// this structural contract is the whole interface.

import type {
  FeedbackId,
  OrganizationId,
  PropertyId,
  RatingId,
  ReviewId,
} from '#/shared/domain/ids'
import type { ReplyView } from './reply-lookup.port'

/** Guest-owned feedback/rating reads (satisfied by the guest interaction repo). */
export type FeedbackLookupSource = Readonly<{
  findFeedbackById: (
    id: FeedbackId,
    orgId: OrganizationId,
  ) => Promise<Readonly<{ comment: string; ratingId: RatingId | null }> | null>
  findRatingById: (
    id: RatingId,
    orgId: OrganizationId,
  ) => Promise<Readonly<{ value: number }> | null>
}>

/** Property-owned name reads (satisfied by the property public API). */
export type PropertyLookupSource = Readonly<{
  getPropertyName: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
  getPropertyNames: (
    orgId: OrganizationId,
    propertyIds: ReadonlyArray<PropertyId>,
  ) => Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>
}>

/** Review-owned reply reads (satisfied by the reply repository). */
export type ReplyLookupSource = Readonly<{
  /** Returns the internal reply for a review. The review repo's
   *  findInternalByReviewId returns its own Reply type, which is structurally
   *  identical to ReplyView — so no mapping is needed. */
  findInternalByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReplyView | null>
  /** Returns ALL replies for a review (internal + google_sync). */
  findByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReplyView>>
}>

/** Structural shape the review repository rows satisfy (metadata only). */
export type ReviewSourceRow = Readonly<{
  id: ReviewId
  propertyId: PropertyId
  platform: string
  reviewedAt: Date
  contentExpiresAt: Date | null
}>

/** Review-owned review-metadata reads (satisfied by the review repository, BQC-3.4). */
export type ReviewSourceLookupSource = Readonly<{
  findById: (id: ReviewId, orgId: OrganizationId) => Promise<ReviewSourceRow | null>
  findByOrganizationId: (orgId: OrganizationId) => Promise<ReadonlyArray<ReviewSourceRow>>
  findByPropertyId: (
    propertyId: PropertyId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReviewSourceRow>>
}>
