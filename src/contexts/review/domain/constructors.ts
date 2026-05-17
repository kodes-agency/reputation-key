// Review context — entity constructors

import type { Review, Reply, SentimentLabel } from './types'
import type { ReviewId, ReplyId, OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import { ok, err } from 'neverthrow'
import { reviewError } from './errors'
import { isValidRating, calculateExpiresAt } from './rules'

type BuildReviewArgs = {
  id: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  externalId: string
  externalLocationId: string
  googleConnectionId: GoogleConnectionId | null
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number
  text: string | null
  languageCode: string | null
  reviewedAt: Date
  now: Date
  sentimentLabel?: SentimentLabel
  sentimentScore?: number | null
}

export const buildReview = (args: BuildReviewArgs) => {
  if (!isValidRating(args.rating)) {
    return err(reviewError('invalid_rating', `Invalid rating: ${args.rating}`))
  }

  const expiresAt = calculateExpiresAt(args.reviewedAt, args.now)

  return ok<Review>({
    id: args.id,
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    platform: 'google',
    externalId: args.externalId,
    externalLocationId: args.externalLocationId,
    googleConnectionId: args.googleConnectionId,
    reviewerName: args.reviewerName,
    reviewerProfilePhotoUrl: args.reviewerProfilePhotoUrl,
    rating: args.rating as Review['rating'],
    text: args.text,
    languageCode: args.languageCode,
    reviewedAt: args.reviewedAt,
    expiresAt,
    sentimentLabel: args.sentimentLabel ?? null,
    sentimentScore: args.sentimentScore ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  })
}

type BuildReplyArgs = {
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  source: 'google_sync' | 'internal'
  status?: 'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected'
  createdBy?: string | null
  publishedAt?: Date | null
  now: Date
}

export const buildReply = (args: BuildReplyArgs) => {
  if (!args.text.trim()) {
    return err(reviewError('invalid_reply', 'Reply text cannot be empty'))
  }

  return ok<Reply>({
    id: args.id,
    reviewId: args.reviewId,
    organizationId: args.organizationId,
    text: args.text,
    status: args.status ?? 'draft',
    source: args.source,
    createdBy: args.createdBy ?? null,
    publishedAt: args.publishedAt ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  })
}
