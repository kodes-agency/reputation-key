// Replace Review ids with Inbox item ids before responding (ADR 0067).
// Goal access does not grant inbox.read: denied viewers get unlinked rows rather
// than a failed page. Batch at most ten ids in one lookup.

import { getContainer } from '#/composition'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  propertyId as toPropertyId,
  reviewId as toReviewId,
  type InboxItemId,
  type PropertyId,
  type ReviewId,
} from '#/shared/domain/ids'
import type {
  RatingGoalDetailRead,
  RatingGoalDetailView,
} from '../application/dto/rating-goal.types'

/** The Inbox items this viewer may open for the reviews; none without `inbox.read`. */
async function inboxItemsFor(
  ctx: AuthContext,
  propertyId: PropertyId,
  reviewIds: readonly ReviewId[],
): Promise<ReadonlyMap<ReviewId, InboxItemId>> {
  if (reviewIds.length === 0) return new Map()
  const { clock, inboxPublicApi } = getContainer()
  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'user', ctx },
    action: 'inbox.read',
    organizationId: ctx.organizationId,
    propertyId,
    executionKind: 'interactive',
    now: clock(),
  })
  if (!decision.allowed) return new Map()
  return inboxPublicApi.getReviewInboxItemIds({ propertyId, reviewIds }, ctx)
}

/** The detail as the browser gets it: each low review's Inbox item, or none, and no review id. */
export async function withInboxItems(
  detail: RatingGoalDetailRead,
  propertyId: string,
  ctx: AuthContext,
): Promise<RatingGoalDetailView> {
  const { lowReviews } = detail.moved
  const items = await inboxItemsFor(
    ctx,
    toPropertyId(propertyId),
    lowReviews.map((row) => toReviewId(row.reviewId)),
  )
  return {
    ...detail,
    moved: {
      ...detail.moved,
      lowReviews: lowReviews.map(({ reviewId, ...row }) => ({
        ...row,
        inboxItemId: items.get(toReviewId(reviewId)) ?? null,
      })),
    },
  }
}
