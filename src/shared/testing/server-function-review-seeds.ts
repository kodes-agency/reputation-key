// Reviews, Inbox items and replies for the server-function harness.
//
// A Review is written as Google sync writes it: identity and provider content,
// with the AI source provenance the reply and analysis paths verify, under the
// Property's Google connection when it has one. An Inbox
// item goes through the atomic item + Handling Cycle path production uses. A
// reply is a human or Google-mirrored row in the status and publication state
// a test names; AI-assisted replies need an AI operation and are out of reach.

import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import type { InboxItem, InboxStatus } from '#/contexts/reputation/domain/inbox-types'
import { storedAiReviewSourceProvenance } from '#/contexts/reputation/reviews/ai-review-source.server'
import type { StarRating } from '#/contexts/reputation/domain/review-types'
import { getDb } from '#/shared/db'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { HarnessSeedContext } from './server-function-seed-context'
import type { TestProperty } from './server-function-property-seeds'

/**
 * The tables these seeds write, children first. Name them in the file's
 * `cleanupTables` (Inbox items and replies hold their Review; Reviews hold
 * their Property).
 */
export const REVIEW_SEED_TABLES = ['inbox_items', 'replies', 'reviews'] as const

export type TestReview = Readonly<{
  id: string
  organizationId: string
  propertyId: string
}>

export type SeedReviewOptions = Readonly<{
  rating?: StarRating
  text?: string | null
  languageCode?: string | null
  reviewerName?: string | null
  reviewedAt?: Date
  /** When Google's terms let RepKey keep the words; a year after `reviewedAt` by default. */
  contentExpiresAt?: Date
  externalLocationId?: string
  sourceRevision?: number
  analysisSequence?: number
}>

export type InboxItemSource =
  | Readonly<{ review: TestReview }>
  /** Private feedback a guest left at the Property. */
  | Readonly<{ feedback: TestProperty }>

export type SeedInboxItemOptions = Readonly<{
  status?: InboxStatus
  rating?: StarRating
  commandRevision?: number
  sourceDate?: Date
  snippet?: string
}>

export type TestInboxItem = Readonly<{
  id: string
  sourceId: string
  propertyId: string
  commandRevision: number
}>

export type ReplyPublicationState =
  | 'requested'
  | 'authorized'
  | 'sending'
  | 'pending_observation'
  | 'published'
  | 'terminal'
  | 'ambiguous'
  | 'cancelled'

export type SeedReplyOptions = Readonly<{
  status:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'published'
    | 'rejected'
    | 'publish_failed'
  text?: string
  /** 'internal' (default) is written in RepKey; 'google_sync' mirrors Google. */
  source?: 'internal' | 'google_sync'
  /** The user who wrote, submitted and approved it. */
  authorUserId?: string
  publicationState?: ReplyPublicationState
  publicationLastErrorClass?: 'terminal_rejection' | 'retryable' | 'ambiguous'
  publicationCycle?: number
  publicationAttempts?: number
  reconcileDueAt?: Date
}>

export type TestReply = Readonly<{ id: string; reviewId: string }>

export type ReviewSeeds = Readonly<{
  seedReview: (property: TestProperty, options?: SeedReviewOptions) => Promise<TestReview>
  seedInboxItem: (
    source: InboxItemSource,
    options?: SeedInboxItemOptions,
  ) => Promise<TestInboxItem>
  seedReply: (review: TestReview, options: SeedReplyOptions) => Promise<TestReply>
}>

const YEAR_MS = 365 * 86_400_000

/**
 * A second before the harness clock, at millisecond precision: commands fence
 * on updated_at, and a row stamped in the future would never match.
 */
function stamp(context: HarnessSeedContext): Date {
  return new Date(context.clock().getTime() - 1000)
}

const PUBLISHED_BY_STATUS: Readonly<Record<SeedReplyOptions['status'], boolean>> = {
  draft: false,
  pending_approval: false,
  approved: false,
  rejected: false,
  published: true,
  publish_failed: false,
}

export function reviewSeeds(context: HarnessSeedContext): ReviewSeeds {
  const { pool } = context

  const seedReview: ReviewSeeds['seedReview'] = async (property, options = {}) => {
    const id = context.newId()
    const rating = options.rating ?? 4
    const text =
      options.text === undefined ? 'The harbour view was lovely.' : options.text
    const languageCode = options.languageCode === undefined ? 'en' : options.languageCode
    const reviewerName = options.reviewerName === undefined ? 'Ana' : options.reviewerName
    const reviewedAt = options.reviewedAt ?? context.clock()
    const provenance = storedAiReviewSourceProvenance({
      text,
      rating,
      languageCode,
      reviewedAtEpochMillis: reviewedAt.getTime(),
      reviewerDisplayName: reviewerName,
    })
    const { rows } = await pool().query<{
      google_connection_id: string | null
      gbp_location_id: string | null
      source_epoch: number
    }>(
      `SELECT google_connection_id, gbp_location_id, source_epoch
         FROM properties WHERE id = $1 AND organization_id = $2`,
      [property.id, property.organizationId],
    )
    const stored = rows[0]
    if (!stored) throw new Error('seedReview needs a seeded Property')
    const contentExpiresAt =
      options.contentExpiresAt ?? new Date(reviewedAt.getTime() + YEAR_MS)
    const sourceRevision = options.sourceRevision ?? 1
    const externalLocationId =
      options.externalLocationId ??
      (stored.gbp_location_id
        ? `locations/${stored.gbp_location_id}`
        : 'locations/harness-review')
    const at = stamp(context)
    await pool().query(
      `WITH identity AS (
         INSERT INTO reviews (
           id, organization_id, property_id, platform, google_connection_id,
           external_id, external_location_id, first_fetched_at, source_epoch,
           source_revision, analysis_sequence, created_at, updated_at
         ) VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $9, $10, $16, $16)
         RETURNING id
       ) INSERT INTO review_source_contents (
         review_id, organization_id, property_id, platform, google_connection_id,
         external_id, external_location_id, reviewer_name, rating, text,
         language_code, reviewed_at, first_fetched_at, last_fetched_at,
         content_expires_at, source_epoch, source_revision,
         ai_source_byte_length, ai_source_digest
       ) SELECT id, $2, $3, 'google', $4, $5, $6, $11, $12, $13, $14, $7, $7, $7,
                $15, $8, $9, $17, $18
           FROM identity`,
      [
        id,
        property.organizationId,
        property.id,
        stored.google_connection_id,
        `harness-${id}`,
        externalLocationId,
        reviewedAt,
        stored.source_epoch,
        sourceRevision,
        options.analysisSequence ?? 1,
        reviewerName,
        rating,
        text,
        languageCode,
        contentExpiresAt,
        at,
        provenance.byteLength,
        provenance.digest,
      ],
    )
    // The material revision an Inbox item and a reply's publication fence anchor to.
    await pool().query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, content_state, created_at, updated_at
       ) VALUES ($1, 1, $2, $3, $4, 'review-material-v1', $5, $5, $6, $7, 'active', $8, $8)`,
      [
        id,
        property.organizationId,
        property.id,
        stored.source_epoch,
        provenance.digest,
        rating,
        text ?? '',
        at,
      ],
    )
    return { id, organizationId: property.organizationId, propertyId: property.id }
  }

  const seedInboxItem: ReviewSeeds['seedInboxItem'] = async (source, options = {}) => {
    const isReview = 'review' in source
    const owner = isReview
      ? {
          organizationId: source.review.organizationId,
          propertyId: source.review.propertyId,
        }
      : { organizationId: source.feedback.organizationId, propertyId: source.feedback.id }
    const at = stamp(context)
    const status = options.status ?? 'open'
    const item: InboxItem = {
      id: inboxItemId(context.newId()),
      organizationId: organizationId(owner.organizationId),
      propertyId: propertyId(owner.propertyId),
      sourceType: isReview ? 'review' : 'feedback',
      sourceId: isReview ? reviewId(source.review.id) : feedbackId(context.newId()),
      status,
      rating: options.rating ?? 4,
      sourceDate: options.sourceDate ?? at,
      platform: isReview ? 'google' : 'direct',
      snippet: options.snippet ?? 'Great!',
      assignedTo: null,
      reviewerName: null,
      propertyName: null,
      isEscalated: false,
      escalatedAt: null,
      escalatedBy: null,
      escalationResolvedAt: null,
      escalationResolvedBy: null,
      closedAt: status === 'closed' ? at : null,
      firstReplySubmittedAt: null,
      firstReplyPublishedAt: null,
      commandRevision: options.commandRevision ?? 1,
      createdAt: at,
      updatedAt: at,
    }
    // The command store's own create, with every command allowed: seeding is
    // not what the test authorizes.
    const store = createAtomicInboxCommandStore(getDb(), async () => ({ allowed: true }))
    const created = isReview
      ? await store.createItem(item, {
          sourceRevision: 1,
          openedReason: 'review_observed',
          actorType: 'provider',
          triggerEventId: null,
          openedAt: item.createdAt,
        })
      : await store.createItem(item, {
          sourceRevision: 1,
          openedReason: 'feedback_submitted',
          actorType: 'guest',
          triggerEventId: null,
          openedAt: at,
        })
    return {
      id: created.item.id,
      sourceId: created.item.sourceId,
      propertyId: created.item.propertyId,
      commandRevision: created.item.commandRevision,
    }
  }

  const seedReply: ReviewSeeds['seedReply'] = async (review, options) => {
    const id = context.newId()
    const source = options.source ?? 'internal'
    const author = source === 'internal' ? (options.authorUserId ?? null) : null
    const at = stamp(context)
    await pool().query(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, created_by,
         submitted_by, approved_by, authorship, publication_state,
         publication_last_error_class, publication_cycle, publication_attempts,
         reconcile_due_at, published_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
      [
        id,
        review.id,
        review.organizationId,
        options.text ?? 'Thank you for staying with us.',
        options.status,
        source,
        author,
        ['approved', 'published', 'publish_failed'].includes(options.status)
          ? author
          : null,
        source === 'internal' ? 'human' : null,
        options.publicationState ?? null,
        options.publicationLastErrorClass ?? null,
        options.publicationCycle ?? (options.publicationState ? 1 : 0),
        options.publicationAttempts ?? 0,
        options.reconcileDueAt ?? null,
        PUBLISHED_BY_STATUS[options.status] ? at : null,
        at,
      ],
    )
    return { id, reviewId: review.id }
  }

  return { seedReview, seedInboxItem, seedReply }
}
