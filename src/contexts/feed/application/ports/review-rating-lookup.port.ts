// Review-owned current rating of one review, read by Feed only to decide
// whether a new or edited review is a Low ratings notice for its reader
// (ADR 0046, amended 2026-09-30). Wired to Review's eligible read, which
// answers null once Google's cache window has passed (ADR 0031), so a notice
// routes on a rating RepKey may still hold — never on a stale one.
//
// The number is compared and dropped: it is never stored on a notification,
// put in a job or an email, or logged. Only the outcome travels, as the
// payload's `lowRating` flag.

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

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
