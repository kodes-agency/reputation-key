// The Google rating goal detail's low reviews (round 5, PLAN-D D-2b, mock D3)
// as the server function hands them to the page: Harborline Suites twenty
// days in (300 reviews at 4.02, 35 since the set summing 160, goal 4.1 at
// 4.5★), with each review's setback worked out by the domain's own rule
// (rating-goal-setback.ts) and the Inbox item that opens it. The page never
// has a review id.
import type {
  RatingGoalDetailView,
  RatingGoalLowReviewView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { DETAIL_HARBORLINE, DETAIL_TOO_LOW } from './rating-goal-detail.stories.fixtures'

export const LOW_REVIEW_ITEM_ONE = '8a3e0c51-6b2d-4f7a-9c14-1d5e7b9a2f01'
export const LOW_REVIEW_ITEM_TWO = '8a3e0c51-6b2d-4f7a-9c14-1d5e7b9a2f02'

/** A 1★ review on Monday 12 Oct: without it 4.1 would need about 8 fewer. */
const ONE_STAR: RatingGoalLowReviewView = {
  at: '2026-10-12T15:10:00.000Z',
  stars: 1,
  setBack: 8,
  inboxItemId: LOW_REVIEW_ITEM_ONE,
}

/** A 2★ review on 6 Oct: about 5. */
const TWO_STARS: RatingGoalLowReviewView = {
  at: '2026-10-06T16:20:00.000Z',
  stars: 2,
  setBack: 5,
  inboxItemId: LOW_REVIEW_ITEM_TWO,
}

const withLowReviews = (
  detail: RatingGoalDetailView,
  lowReviews: readonly RatingGoalLowReviewView[],
): RatingGoalDetailView => ({ ...detail, moved: { ...detail.moved, lowReviews } })

/** Two low reviews since the set, each with the Inbox item that opens it. */
export const DETAIL_LOW_REVIEWS = withLowReviews(DETAIL_HARBORLINE, [ONE_STAR, TWO_STARS])

/** The same, for a viewer the policy refuses the Inbox: the rows, no links. */
export const DETAIL_LOW_REVIEWS_WITHOUT_INBOX = withLowReviews(DETAIL_HARBORLINE, [
  { ...ONE_STAR, inboxItemId: null },
  { ...TWO_STARS, inboxItemId: null },
])

/** New reviews too low for any count to reach 4.1: the low review is named, no setback. */
export const DETAIL_SETBACK_NULL = withLowReviews(DETAIL_TOO_LOW, [
  { ...ONE_STAR, setBack: null },
])
