// Server-only: the rating goal detail's low reviews, linked to the Inbox items
// that open them (round 5, PLAN-D D-2b, E17/E18; the owner's exception, ADR
// 0067 2026-10-17). The use case hands its rows over with Review's ids; here
// they become Inbox item ids and the review ids are dropped, so the browser
// never sees one. Opening an item is an Inbox read, which `goal.read` does not
// grant: a viewer the policy refuses `inbox.read` on the Property gets the
// rows without links rather than a failed page (ai/server/property-trend.ts is
// the precedent). One lookup for at most ten ids.
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
