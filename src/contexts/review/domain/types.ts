// Review context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  GoogleConnectionId,
  UserId,
} from '#/shared/domain/ids'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'
import type {
  PersistedPublicationState,
  PublicationFailureClass,
} from './reply-publication-workflow'

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
  // PRE17B / BQR-1.1: Source content lifecycle (migration 0006)
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  firstFetchedAt: Date | null
  lastFetchedAt: Date | null
  contentExpiresAt: Date | null
  contentHash: string | null
  sourceSeenGeneration: string | null
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
  createdBy: UserId | null
  approvedBy: UserId | null
  rejectedBy: UserId | null
  rejectionReason: string | null
  aiGenerated: boolean
  submittedAt: Date | null
  approvedAt: Date | null
  publishedAt: Date | null
  // BQC-3.8: durable publication state machine overlay (migration 0015).
  // All four are null/0 when no publication workflow is active (drafts,
  // pre-0015 legacy rows). See domain/reply-publication-workflow.ts.
  publicationState: PersistedPublicationState | null
  publicationAttempts: number
  publicationLastErrorClass: PublicationFailureClass | null
  reconcileDueAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

/**
 * Default source-lifecycle fields when constructing or refreshing a review.
 *
 * BQR-3.1 / ADR 0031:
 * - `lastFetchedAt` is always the successful fetch instant (`now`).
 * - `contentExpiresAt` is always derived from that fetch (policy TTL), never
 *   preserved from a prior observation or from publication time.
 * - `contentHash` is supplied by the caller from current source fields so
 *   unchanged vs content-changed refreshes can be distinguished (BQR-3.4).
 */
export function defaultReviewLifecycle(args: {
  reviewedAt: Date
  now: Date
  /** Hash of current normalized source fields; required on production write paths. */
  contentHash?: string | null
  existing?: Pick<
    Review,
    | 'sourceCreatedAt'
    | 'sourceUpdatedAt'
    | 'firstFetchedAt'
    | 'lastFetchedAt'
    | 'contentExpiresAt'
    | 'contentHash'
    | 'sourceSeenGeneration'
  > | null
}): Pick<
  Review,
  | 'sourceCreatedAt'
  | 'sourceUpdatedAt'
  | 'firstFetchedAt'
  | 'lastFetchedAt'
  | 'contentExpiresAt'
  | 'contentHash'
  | 'sourceSeenGeneration'
> {
  const existing = args.existing
  const lastFetchedAt = args.now
  return {
    sourceCreatedAt: existing?.sourceCreatedAt ?? args.reviewedAt,
    sourceUpdatedAt: existing?.sourceUpdatedAt ?? null,
    firstFetchedAt: existing?.firstFetchedAt ?? args.now,
    lastFetchedAt,
    contentExpiresAt: contentExpiresAtFromFetch(lastFetchedAt),
    contentHash: args.contentHash ?? existing?.contentHash ?? null,
    sourceSeenGeneration: existing?.sourceSeenGeneration ?? null,
  }
}

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
