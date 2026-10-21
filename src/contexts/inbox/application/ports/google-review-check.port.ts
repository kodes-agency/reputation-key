import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/**
 * Inbox-owned boundary for "read this review from Google once", used before a
 * Response Target reminder for a Google review is released (ADR 0008 §1).
 *
 * Review owns the read and what it records; Inbox only learns how it went,
 * content-free, and then reads the resulting reply head through the reply
 * lookup it already has. The union below deliberately mirrors Review's own
 * `CheckReviewOnGoogleResult` instead of importing it: the two are expected to
 * drift, and neither side should be changed by the other without a decision.
 */

export type GoogleReviewCheckRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
}>

// fallow-ignore-next-line code-duplication
export type GoogleReviewCheckOutcome =
  /** Google was read and its reply state recorded. */
  | Readonly<{ status: 'read' }>
  /** Google shows a reply whose text could not be recovered; nothing was recorded. */
  | Readonly<{ status: 'reply_unreadable' }>
  /** Google answered 404 for the review. */
  | Readonly<{ status: 'review_missing' }>
  /** Nothing was read, and waiting will not change that. */
  | Readonly<{
      status: 'not_checkable'
      reason:
        | 'review_unavailable'
        | 'content_expired'
        | 'scope_mismatch'
        | 'property_not_bound'
        | 'capability_off'
        | 'no_provider'
        | 'source_moved'
    }>
  /** The read failed: `later` may work on a later try, `never` will not. */
  | Readonly<{ status: 'unavailable'; retry: 'later' | 'never' }>

export type GoogleReviewCheckPort = Readonly<{
  /** Never throws for a provider or store failure: those come back as `unavailable`. */
  check(request: GoogleReviewCheckRequest): Promise<GoogleReviewCheckOutcome>
}>
