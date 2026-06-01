// Review context — domain events
// Per architecture: "Events are facts, named in the past tense."

import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
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
  reviewText: string | null
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
  reviewText: string | null
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

// fallow-ignore-next-line unused-type
export type ReplyPublished = Readonly<{
  _tag: 'reply.published'
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type ReplySubmitted = Readonly<{
  _tag: 'reply.submitted'
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type ReplyApproved = Readonly<{
  _tag: 'reply.approved'
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type ReplyRejected = Readonly<{
  _tag: 'reply.rejected'
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  reason: string | null
  occurredAt: Date
}>

export type ReplyEvent = ReplyPublished | ReplySubmitted | ReplyApproved | ReplyRejected

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

export const replyPublished = (args: Omit<ReplyPublished, '_tag'>): ReplyPublished => ({
  _tag: 'reply.published',
  ...args,
})

export const replySubmitted = (args: Omit<ReplySubmitted, '_tag'>): ReplySubmitted => ({
  _tag: 'reply.submitted',
  ...args,
})

export const replyApproved = (args: Omit<ReplyApproved, '_tag'>): ReplyApproved => ({
  _tag: 'reply.approved',
  ...args,
})

export const replyRejected = (args: Omit<ReplyRejected, '_tag'>): ReplyRejected => ({
  _tag: 'reply.rejected',
  ...args,
})
