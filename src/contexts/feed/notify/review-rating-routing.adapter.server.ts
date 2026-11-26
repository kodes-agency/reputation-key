// The rating a new or edited review is routed by: whether it is a Low ratings
// notice for its reader (ADR 0046, amended 2026-09-30).
//
// Two reads, each from its owner: the item's review id from Reputation's named Inbox lookup,
// and the rating from Review's eligible lookup, which answers null once
// Google's cache window has passed (ADR 0031). Inbox's copy of a Google
// rating was removed (BQC-1.2) and is never read here. The number goes back
// to the caller to be compared and dropped — nothing here stores or logs it.

import type { Database } from '#/shared/db'
import { createInboxNotificationLookup } from '#/contexts/reputation/public-api'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewRatingForRouting,
  ReviewRatingLookupPort,
} from './cross-context-lookups.port.server'

export const createReviewRatingForRouting = (
  db: Database,
  reviewRatings: ReviewRatingLookupPort,
): ReviewRatingForRouting => {
  const inbox = createInboxNotificationLookup(db)
  return async ({ organizationId, inboxItemId: itemId }) => {
    const row = await inbox.findItem(inboxItemId(itemId), organizationId)
    if (row?.sourceType !== 'review') return null
    return reviewRatings.getEligibleRatingById(reviewId(row.sourceId), organizationId)
  }
}
