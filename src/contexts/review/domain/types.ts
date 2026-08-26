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
  /**
   * Google's machine translation of `text`, split out of the single
   * `(Translated by Google) … (Original) …` provider field. `text` always holds
   * the guest's own words so language detection and the AI reply plane read the
   * original; this field exists only for display.
   */
  translatedText: string | null
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
  /** Property binding generation captured for this source observation. */
  sourceEpoch: number
  /** Monotonic content revision; unchanged refreshes preserve it. */
  sourceRevision: number
  /** Gap-free source event sequence within the Property/source epoch. */
  analysisSequence: number
  /** Exact canonical ai-source-v1 byte length retained only in Review storage. */
  aiSourceByteLength: number
  /** Lowercase SHA-256 over the domain-separated canonical source bytes. */
  aiSourceDigest: string
  createdAt: Date
  updatedAt: Date
}>

export type ReplyStatus =
  'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected' | 'publish_failed'
export type ReplySource = 'google_sync' | 'internal'

export type Reply = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  /** Canonical concrete language selected for the public reply text. */
  replyLanguageTag?: string | null
  status: ReplyStatus
  source: ReplySource
  createdBy: UserId | null
  approvedBy: UserId | null
  rejectedBy: UserId | null
  rejectionReason: string | null
  aiGenerated: boolean
  /** Monotonic lifecycle revision used to bind ephemeral AI suggestions. */
  stateRevision: number
  submittedAt: Date | null
  approvedAt: Date | null
  publishedAt: Date | null
  // BQC-3.8: durable publication state machine overlay (migration 0015).
  // All four are null/0 when no publication workflow is active (drafts,
  // pre-0015 legacy rows). See domain/reply-publication-workflow.ts.
  publicationState: PersistedPublicationState | null
  /**
   * Monotonic authorization cycle. Queue jobs and durable publication intents
   * carry this value so delivery from an older approval/edit/retry cycle can
   * never claim the current reply. Zero is the pre-RPL-01 legacy generation.
   */
  publicationCycle: number
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
  /** Current property binding generation. */
  sourceEpoch?: number
  /** Exact canonical source byte length computed by the infrastructure boundary. */
  aiSourceByteLength: number
  /** Domain-separated lowercase SHA-256 computed by the infrastructure boundary. */
  aiSourceDigest: string
  existing?: Pick<
    Review,
    | 'sourceCreatedAt'
    | 'sourceUpdatedAt'
    | 'firstFetchedAt'
    | 'lastFetchedAt'
    | 'contentExpiresAt'
    | 'contentHash'
    | 'sourceSeenGeneration'
    | 'sourceEpoch'
    | 'sourceRevision'
    | 'analysisSequence'
    | 'aiSourceByteLength'
    | 'aiSourceDigest'
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
  | 'sourceEpoch'
  | 'sourceRevision'
  | 'analysisSequence'
  | 'aiSourceByteLength'
  | 'aiSourceDigest'
> {
  const existing = args.existing
  const lastFetchedAt = args.now
  const aiSourceDigest = args.aiSourceDigest
  return {
    sourceCreatedAt: existing?.sourceCreatedAt ?? args.reviewedAt,
    sourceUpdatedAt: existing?.sourceUpdatedAt ?? null,
    firstFetchedAt: existing?.firstFetchedAt ?? args.now,
    lastFetchedAt,
    contentExpiresAt: contentExpiresAtFromFetch(lastFetchedAt),
    contentHash: args.contentHash ?? existing?.contentHash ?? null,
    sourceSeenGeneration: existing?.sourceSeenGeneration ?? null,
    sourceEpoch: args.sourceEpoch ?? existing?.sourceEpoch ?? 0,
    // The repository-owned material comparator is the sole revision-number
    // authority. Lifecycle defaults preserve an existing revision and never
    // infer a guest edit from AI-source or metadata changes.
    sourceRevision: existing?.sourceRevision ?? 1,
    analysisSequence: existing?.analysisSequence ?? 0,
    aiSourceByteLength: args.aiSourceByteLength,
    aiSourceDigest,
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
  /** Google's machine translation; `text` holds the guest's original words. */
  translatedText: string | null
  languageCode: string | null
  reviewedAt: Date
  /** Provider-authored creation clock, when supplied by the source adapter. */
  sourceCreatedAt?: Date
  /** Provider-authored update clock used to reject out-of-order observations. */
  sourceUpdatedAt?: Date | null
  replyText: string | null
  replyUpdatedAt: Date | null
}>
