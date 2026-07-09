// Review context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
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
  reviewerName: string | null
  reviewText: string | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewCreated = (
  args: Omit<ReviewCreated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.created',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  args: Omit<ReviewUpdated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.updated',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  args: Omit<ReviewExpired, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewExpired => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.expired',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  authorId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublished = (
  args: Omit<ReviewReplyPublished, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyPublished => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.published',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
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
  args: Omit<ReviewReplySubmitted, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplySubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.submitted',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
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
  authorId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyApproved = (
  args: Omit<ReviewReplyApproved, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyApproved => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.approved',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
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
  authorId: UserId | null
  reason: string | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyRejected = (
  args: Omit<ReviewReplyRejected, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyRejected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.rejected',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
  }
}

export type ReviewReplyPublishFailed = Readonly<{
  _tag: 'review.reply.publish_failed'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  authorId: UserId | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublishFailed = (
  args: Omit<ReviewReplyPublishFailed, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyPublishFailed => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.publish_failed',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
