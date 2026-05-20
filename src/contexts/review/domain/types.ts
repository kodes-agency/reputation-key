// Review context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  GoogleConnectionId,
} from '#/shared/domain/ids'

export type ReviewPlatform = 'google'

/** Star rating 1–5. Branded to prevent accidental assignment of arbitrary numbers. */
export type StarRating = 1 | 2 | 3 | 4 | 5

/**
 * Sentiment label from analysis. Currently only 'positive' | 'negative' | 'neutral' | 'mixed'
 * are expected, but kept as string | null to allow future NLP provider values without migrations.
 * Narrow to a union once the sentiment provider is stabilized.
 */
export type SentimentLabel = string | null

export type Review = Readonly<{
  id: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  platform: ReviewPlatform
  externalId: string
  externalLocationId: string
  googleConnectionId: GoogleConnectionId | null
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  rating: StarRating
  text: string | null
  languageCode: string | null
  reviewedAt: Date
  expiresAt: Date
  sentimentLabel: SentimentLabel
  sentimentScore: number | null
  createdAt: Date
  updatedAt: Date
}>

export type ReplyStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'publish_failed'
export type ReplySource = 'google_sync' | 'internal'

export type Reply = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  status: ReplyStatus
  source: ReplySource
  createdBy: string | null
  approvedBy: string | null
  rejectedBy: string | null
  rejectionReason: string | null
  aiGenerated: boolean
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

/** Raw review data from Google API, before domain mapping. */
export type GoogleReview = Readonly<{
  reviewName: string
  externalId: string
  externalLocationId: string
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  rating: StarRating
  text: string | null
  languageCode: string | null
  reviewedAt: Date
  replyText: string | null
  replyUpdatedAt: Date | null
}>
