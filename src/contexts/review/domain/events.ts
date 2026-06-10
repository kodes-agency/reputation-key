// Review context — domain events
// Standards: docs/standards.md §1

import assert from 'node:assert/strict'
import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
import type { ReviewPlatform, StarRating } from './types'

export type ReviewCreated = Readonly<{
  _tag: 'review.created'
  eventId: string
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: ReviewPlatform
  externalId: string
  rating: StarRating
  reviewText: string | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewCreated = (
  args: Omit<ReviewCreated, '_tag' | 'eventId' | 'correlationId'>,
): ReviewCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.created',
    eventId: crypto.randomUUID(),
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
  reviewText: string | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewUpdated = (
  args: Omit<ReviewUpdated, '_tag' | 'eventId' | 'correlationId'>,
): ReviewUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.updated',
    eventId: crypto.randomUUID(),
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
  args: Omit<ReviewExpired, '_tag' | 'eventId' | 'correlationId'>,
): ReviewExpired => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.expired',
    eventId: crypto.randomUUID(),
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
  userId: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublished = (
  args: Omit<
    ReviewReplyPublished,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source'
  > & { userId?: UserId; source?: 'web' | 'import' },
): ReviewReplyPublished => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.reply.published',
    eventId: crypto.randomUUID(),
    correlationId: null,
    userId: args.userId ?? ('' as UserId),
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
  args: Omit<
    ReviewReplySubmitted,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source'
  > & { userId?: UserId; source?: 'web' | 'import' },
): ReviewReplySubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.reply.submitted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    userId: args.userId ?? ('' as UserId),
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
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyApproved = (
  args: Omit<
    ReviewReplyApproved,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source'
  > & { userId?: UserId; source?: 'web' | 'import' },
): ReviewReplyApproved => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.reply.approved',
    eventId: crypto.randomUUID(),
    correlationId: null,
    userId: args.userId ?? ('' as UserId),
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
  reason: string | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyRejected = (
  args: Omit<
    ReviewReplyRejected,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source'
  > & { userId?: UserId; source?: 'web' | 'import' },
): ReviewReplyRejected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.reply.rejected',
    eventId: crypto.randomUUID(),
    correlationId: null,
    userId: args.userId ?? ('' as UserId),
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
  args: Omit<ReviewReplyPublishFailed, '_tag' | 'eventId' | 'correlationId'>,
): ReviewReplyPublishFailed => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'review.reply.publish_failed',
    eventId: crypto.randomUUID(),
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
