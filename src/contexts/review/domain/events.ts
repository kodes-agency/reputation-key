// Review context — domain events
// Per architecture: "Events are facts, named in the past tense."

import type { ReviewId, PropertyId, OrganizationId } from '#/shared/domain/ids'
import type { ReviewPlatform, StarRating } from './types'

// fallow-ignore-next-line unused-type
export type ReviewCreated = Readonly<{
  _tag: 'review.created'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: ReviewPlatform
  externalId: string
  rating: StarRating
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type ReviewUpdated = Readonly<{
  _tag: 'review.updated'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: ReviewPlatform
  externalId: string
  rating: StarRating
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type ReviewExpired = Readonly<{
  _tag: 'review.expired'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type ReviewEvent = ReviewCreated | ReviewUpdated | ReviewExpired

// NOTE: No ReviewPurged event is emitted when the purge job hard-deletes expired reviews.
// Purged reviews are already expired (review.expired event was emitted earlier) and are
// removed from the DB after a 3-day grace period. If downstream systems need to react to
// permanent deletion (e.g., cleanup of related resources), a review.purged event should be
// added to this union and emitted in the purge job handler.

// ── Event constructors ──────────────────────────────────────────────

export const reviewCreated = (args: Omit<ReviewCreated, '_tag'>): ReviewCreated => ({
  _tag: 'review.created',
  ...args,
})

export const reviewUpdated = (args: Omit<ReviewUpdated, '_tag'>): ReviewUpdated => ({
  _tag: 'review.updated',
  ...args,
})

export const reviewExpired = (args: Omit<ReviewExpired, '_tag'>): ReviewExpired => ({
  _tag: 'review.expired',
  ...args,
})
