// Review context — entity constructors

import {
  defaultReviewLifecycle,
  type Review,
  type Reply,
  type SentimentLabel,
} from './types'
import type {
  ReviewId,
  ReplyId,
  OrganizationId,
  PropertyId,
  GoogleConnectionId,
  UserId,
} from '#/shared/domain/ids'
import { ok, err } from '#/shared/domain'
import { reviewError } from './errors'
import {
  isValidRating,
  calculateExpiresAt,
  computeReviewContentHash,
  MAX_REPLY_LENGTH,
} from './rules'

type BuildReviewArgs = Readonly<{
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
  /** Provider machine translation; absent for every non-Google origin. */
  translatedText?: string | null
  languageCode: string | null
  reviewedAt: Date
  now: Date
  aiSourceByteLength: number
  aiSourceDigest: string
  sentimentLabel?: SentimentLabel
  sentimentScore?: number | null
}>

export const buildReview = (args: BuildReviewArgs) => {
  if (!isValidRating(args.rating)) {
    return err(reviewError('invalid_rating', `Invalid rating: ${args.rating}`))
  }

  const expiresAt = calculateExpiresAt(args.reviewedAt, args.now)
  const contentHash = computeReviewContentHash({
    rating: args.rating,
    text: args.text,
    reviewerName: args.reviewerName,
    languageCode: args.languageCode,
  })

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
    translatedText: args.translatedText ?? null,
    languageCode: args.languageCode,
    reviewedAt: args.reviewedAt,
    expiresAt,
    sentimentLabel: args.sentimentLabel ?? null,
    sentimentScore: args.sentimentScore ?? null,
    ...defaultReviewLifecycle({
      reviewedAt: args.reviewedAt,
      now: args.now,
      contentHash,
      aiSourceByteLength: args.aiSourceByteLength,
      aiSourceDigest: args.aiSourceDigest,
    }),
    createdAt: args.now,
    updatedAt: args.now,
  })
}

type BuildReplyArgs = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  source: 'google_sync' | 'internal'
  status?: Reply['status']
  createdBy?: UserId | null
  approvedBy?: UserId | null
  rejectedBy?: UserId | null
  rejectionReason?: string | null
  aiGenerated?: boolean
  submittedAt?: Date | null
  approvedAt?: Date | null
  publishedAt?: Date | null
  now: Date
}>

export const buildReply = (args: BuildReplyArgs) => {
  if (!args.text.trim()) {
    return err(reviewError('invalid_reply', 'Reply text cannot be empty'))
  }

  if (args.text.length > MAX_REPLY_LENGTH) {
    return err(
      reviewError('invalid_reply', `Reply text exceeds ${MAX_REPLY_LENGTH} characters`),
    )
  }

  return ok<Reply>({
    id: args.id,
    reviewId: args.reviewId,
    organizationId: args.organizationId,
    text: args.text,
    status: args.status ?? 'draft',
    source: args.source,
    createdBy: args.createdBy ?? null,
    approvedBy: args.approvedBy ?? null,
    rejectedBy: args.rejectedBy ?? null,
    rejectionReason: args.rejectionReason ?? null,
    aiGenerated: args.aiGenerated ?? false,
    stateRevision: 1,
    submittedAt: args.submittedAt ?? null,
    approvedAt: args.approvedAt ?? null,
    publishedAt: args.publishedAt ?? null,
    // BQC-3.8: no publication workflow active at construction.
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: args.now,
    updatedAt: args.now,
  })
}
