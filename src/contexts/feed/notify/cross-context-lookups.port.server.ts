// Narrow lookups Feed asks other owners by name; none exposes a repository.

import type {
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'

// Feed notification surface — whether a Property is still inside the
// workspace. Property eligibility answers who may act on a Property, and
// ignores its lifecycle; an archived Property still has eligible managers, but
// nobody can approve or publish anything there.

export type ActivePropertyLookup = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
) => Promise<boolean>

/** Guest-owned, content-free source attribution used for feedback routing. */
export type FeedbackPortalLookupPort = Readonly<{
  findPortalId(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<PortalId | null>
}>

/**
 * Tenant-authored display names for notices that have nothing else to read
 * them from (ADR 0046 r.8 admits Property and Organization names).
 */
export type DisplayNameLookupPort = Readonly<{
  findPropertyName(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<string | null>
  findOrganizationName(organizationId: OrganizationId): Promise<string | null>
}>

// Feed notification surface — who may approve a reply, right now.
//
// Responsibility and permission are separate authorities: a Property's
// responsible managers are the people who own its work, but only the ones who
// hold `reply.manage` can act on an approval request. Identity owns that
// decision; Feed asks it by name and never reads roles or grants itself.

export type ReplyApprovalAuthorityPort = Readonly<{
  /** Whether this member may approve or reject replies for the Property now. */
  canApproveReplies(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ): Promise<boolean>
}>

// Feed notification surface — where a review's reply stands, right now.
//
// "Approve a reply" and "Reply not published" ask for work on the reply, and
// Review owns the reply. Feed asks for its status by name, content-free, so it
// can tell whether that work is still waiting before it writes or mails a
// notice (ADR 0046, amended 2026-09-24).

export type ReplyWorkStatus =
  'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected' | 'publish_failed'

export type ReplyWorkStateLookupPort = Readonly<{
  /** The status of the review's RepKey-authored reply; null when it has none. */
  findReplyStatus(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<ReplyWorkStatus | null>
}>

// Review-owned current rating of one review, read by Feed only to decide
// whether a new or edited review is a Low ratings notice for its reader
// (ADR 0046, amended 2026-09-30). Wired to Review's eligible read, which
// answers null once Google's cache window has passed (ADR 0031), so a notice
// routes on a rating RepKey may still hold — never on a stale one.
//
// The number is compared and dropped: it is never stored on a notification,
// put in a job or an email, or logged. Only the outcome travels, as the
// payload's `lowRating` flag.

export type ReviewRatingLookupPort = Readonly<{
  getEligibleRatingById(id: ReviewId, orgId: OrganizationId): Promise<number | null>
}>

/**
 * The current eligible rating of the review an Inbox item is about, or null
 * for feedback, a missing item, or content past Google's cache window.
 */
export type ReviewRatingForRouting = (
  input: Readonly<{ organizationId: OrganizationId; inboxItemId: string }>,
) => Promise<number | null>
