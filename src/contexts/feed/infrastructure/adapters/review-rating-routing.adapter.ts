// The rating a new or edited review is routed by: whether it is a Low ratings
// notice for its reader (ADR 0046, amended 2026-09-30).
//
// Two reads, each from its owner: the item's review id from Inbox's own row,
// and the rating from Review's eligible lookup, which answers null once
// Google's cache window has passed (ADR 0031). Inbox's copy of a Google
// rating was removed (BQC-1.2) and is never read here. The number goes back
// to the caller to be compared and dropped — nothing here stores or logs it.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { reviewId, unbrand } from '#/shared/domain/ids'
import type {
  ReviewRatingForRouting,
  ReviewRatingLookupPort,
} from '../../application/ports/review-rating-lookup.port'

export const createReviewRatingForRouting =
  (db: Database, reviewRatings: ReviewRatingLookupPort): ReviewRatingForRouting =>
  async ({ organizationId, inboxItemId }) => {
    const rows = await db
      .select({ sourceId: inboxItems.sourceId })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, unbrand(organizationId)),
          eq(inboxItems.id, inboxItemId),
          eq(inboxItems.sourceType, 'review'),
        ),
      )
      .limit(1)
    if (!rows[0]) return null
    return reviewRatings.getEligibleRatingById(reviewId(rows[0].sourceId), organizationId)
  }
