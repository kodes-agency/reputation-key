// Inbox context — cross-context lookup SOURCES (BQC-5.2).
//
// Narrow structural types for the foreign-owned read pieces the inbox build
// adapts into its lookup ports. The composition root supplies the owning
// contexts' repos / public APIs; inbox never imports their infrastructure —
// this structural contract is the whole interface.

import type {
  FeedbackId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { ReplyMilestones, ReplyView } from './reply-lookup.port'
import type { FeedbackContentFilter } from './feedback-lookup.port'

/**
 * Guest-owned feedback/rating reads.
 *
 * Two storage generations, in precedence order:
 *  - `findResponseSnippetsByIds` reads the CURRENT `guest_responses` aggregate,
 *    which holds the rating and the text on one row. This is what the live
 *    guest form writes, so every new feedback inbox item resolves here.
 *  - `findLegacyFeedbackSnippetsByIds` reads the LEGACY `feedback`/`ratings`
 *    pair, kept so inbox items created before the aggregate still render.
 *
 * The adapter tries the aggregate first and falls back; an id can only exist in
 * one generation, so there is no ambiguity.
 */
export type FeedbackLookupSource = Readonly<{
  findResponseSnippetsByIds: (
    ids: ReadonlyArray<FeedbackId>,
    orgId: OrganizationId,
  ) => Promise<
    ReadonlyArray<
      Readonly<{ id: FeedbackId; comment: string | null; ratingValue: number | null }>
    >
  >
  findEligibleResponseIds: (
    orgId: OrganizationId,
    filter: FeedbackContentFilter,
  ) => Promise<ReadonlyArray<FeedbackId>>
  findLegacyFeedbackSnippetsByIds: (
    ids: ReadonlyArray<FeedbackId>,
    orgId: OrganizationId,
  ) => Promise<
    ReadonlyArray<
      Readonly<{ id: FeedbackId; comment: string | null; ratingValue: number | null }>
    >
  >
  findEligibleLegacyFeedbackIds: (
    orgId: OrganizationId,
    filter: FeedbackContentFilter,
  ) => Promise<ReadonlyArray<FeedbackId>>
}>

/** Property-owned name reads (satisfied by the property public API). */
export type PropertyLookupSource = Readonly<{
  getPropertyName: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
  getPropertyNames: (
    orgId: OrganizationId,
    propertyIds: ReadonlyArray<PropertyId>,
  ) => Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>
  /** Optional for legacy source fixtures; the adapter normalizes absence to null. */
  getPropertyReplyLanguage?: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

/** Review-owned reply reads (satisfied by the reply repository). */
export type ReplyLookupSource = Readonly<{
  /** Returns ALL replies for a review (internal + google_sync). */
  findByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReplyView>>
  /** Content-free, one-query lifecycle aggregation for projection repair. */
  findMilestonesByReviewIds: (
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<Readonly<{ reviewId: ReviewId } & ReplyMilestones>>>
}>

/** Structural shape the review repository rows satisfy (metadata only). */
export type ReviewSourceRow = Readonly<{
  id: ReviewId
  propertyId: PropertyId
  platform: string
  reviewedAt: Date
  contentExpiresAt: Date | null
  sourceRevision?: number
}>

/** Review-owned review-metadata reads (satisfied by the review repository, BQC-3.4). */
export type ReviewSourceLookupSource = Readonly<{
  findById: (id: ReviewId, orgId: OrganizationId) => Promise<ReviewSourceRow | null>
  findByOrganizationId: (orgId: OrganizationId) => Promise<ReadonlyArray<ReviewSourceRow>>
  findByPropertyId: (
    propertyId: PropertyId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReviewSourceRow>>
}>
