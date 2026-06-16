// Review context — domain events
// Standards: docs/standards.md §1

import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
import type { ReviewPlatform, StarRating } from './types'
import { reviewError } from './errors'

export type ReviewCreated = Readonly<{
  _tag: 'review.created'
  eventId: string
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: ReviewPlatform
  externalId: string
  rating: StarRating
  reviewerName: string | null
  reviewText: string | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewCreated = (
  args: Omit<ReviewCreated, '_tag' | 'correlationId'>,
): ReviewCreated => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.created',
    correlationId: null,
    ...args,
  }
}

export type ReviewUpdated = Readonly<{
  _tag: 'review.updated'
  eventId: string
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: ReviewPlatform
  externalId: string
  rating: StarRating
  reviewerName: string | null
  reviewText: string | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewUpdated = (
  args: Omit<ReviewUpdated, '_tag' | 'correlationId'>,
): ReviewUpdated => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.updated',
    correlationId: null,
    ...args,
  }
}

export type ReviewExpired = Readonly<{
  _tag: 'review.expired'
  eventId: string
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const reviewExpired = (
  args: Omit<ReviewExpired, '_tag' | 'correlationId'>,
): ReviewExpired => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.expired',
    correlationId: null,
    ...args,
  }
}

export type ReviewReplyPublished = Readonly<{
  _tag: 'review.reply.published'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId | null
  authorId: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublished = (
  args: Omit<ReviewReplyPublished, '_tag' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
  },
): ReviewReplyPublished => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.reply.published',
    correlationId: null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type ReviewReplySubmitted = Readonly<{
  _tag: 'review.reply.submitted'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplySubmitted = (
  args: Omit<ReviewReplySubmitted, '_tag' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
  },
): ReviewReplySubmitted => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.reply.submitted',
    correlationId: null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type ReviewReplyApproved = Readonly<{
  _tag: 'review.reply.approved'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  authorId: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyApproved = (
  args: Omit<ReviewReplyApproved, '_tag' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
  },
): ReviewReplyApproved => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.reply.approved',
    correlationId: null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type ReviewReplyRejected = Readonly<{
  _tag: 'review.reply.rejected'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  userId: UserId
  authorId: UserId
  reason: string | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyRejected = (
  args: Omit<ReviewReplyRejected, '_tag' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
  },
): ReviewReplyRejected => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.reply.rejected',
    correlationId: null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type ReviewReplyPublishFailed = Readonly<{
  _tag: 'review.reply.publish_failed'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  authorId: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublishFailed = (
  args: Omit<ReviewReplyPublishFailed, '_tag' | 'correlationId'>,
): ReviewReplyPublishFailed => {
  if (!(args.occurredAt instanceof Date))
    throw reviewError('invalid_rating', 'occurredAt must be Date')
  return {
    _tag: 'review.reply.publish_failed',
    correlationId: null,
    ...args,
  }
}

export type ReviewEvent =
  | ReviewCreated
  | ReviewUpdated
  | ReviewExpired
  | ReviewReplyPublished
  | ReviewReplySubmitted
  | ReviewReplyApproved
  | ReviewReplyRejected
  | ReviewReplyPublishFailed
