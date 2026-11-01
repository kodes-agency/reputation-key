// The low review a manager is sent to read first, and the row that opens it (2026-11-01,
// ADR 0067): the newest review of 3★ or less this viewer may open, named with its day
// and what it set the goal back. How many were low is `rating-goal-review-facts-view.test.ts`.
import { describe, expect, it } from 'vitest'
import type { RatingGoalLowReviewView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { lowReviewRow, newestLowReview } from './rating-goal-review-facts-view'
import { DETAIL_HARBORLINE } from './rating-goal-detail.stories.fixtures'
import { DETAIL_LOW_REVIEWS } from './rating-goal-low-reviews.stories.fixtures'
import { FIXTURE_NOW, FIXTURE_TIMEZONE } from './rating-goal.stories.fixtures'

type Detail = Parameters<typeof newestLowReview>[0]

const context = { timezone: FIXTURE_TIMEZONE, now: new Date(FIXTURE_NOW) }

describe('the low review to read first', () => {
  const review = (
    stars: number,
    inboxItemId: string | null,
    at = '2026-10-12T15:10:00.000Z',
  ): RatingGoalLowReviewView => ({ at, stars, setBack: 4, inboxItemId })
  const withReviews = (...reviews: RatingGoalLowReviewView[]): Detail => ({
    ...DETAIL_HARBORLINE,
    moved: { ...DETAIL_HARBORLINE.moved, lowReviews: reviews },
  })

  it('is the newest review of 3★ or less, which this viewer may open', () => {
    const first = newestLowReview(DETAIL_LOW_REVIEWS)

    expect(first).toMatchObject({ stars: 1, at: '2026-10-12T15:10:00.000Z' })
    expect(first?.inboxItemId).not.toBeNull()
  })

  it('skips a 4★ review, which sets a goal back a little but is not the one to read first', () => {
    const picked = newestLowReview(withReviews(review(4, 'item-4'), review(3, 'item-3')))

    expect(picked?.inboxItemId).toBe('item-3')
  })

  it('skips a review this viewer may not open', () => {
    const picked = newestLowReview(withReviews(review(2, null), review(1, 'item-1')))

    expect(picked?.inboxItemId).toBe('item-1')
  })

  it('takes a review of 3★ and no review of more', () => {
    expect(newestLowReview(withReviews(review(3, 'item-3')))?.stars).toBe(3)
    expect(newestLowReview(withReviews(review(4, 'item-4')))).toBeNull()
  })

  it('is none when no review qualifies, or there are none', () => {
    expect(newestLowReview(withReviews(review(2, null), review(5, 'item-5')))).toBeNull()
    expect(newestLowReview(withReviews())).toBeNull()
    expect(newestLowReview(DETAIL_HARBORLINE)).toBeNull()
  })

  it('names the review, its day, and what it set the goal back', () => {
    expect(lowReviewRow(review(1, 'item-1'), context)).toEqual({
      title: 'Read the 1★ review from Oct 12',
      note: 'It set you back about 4 new reviews.',
    })
  })

  it('says one new review in the singular', () => {
    expect(lowReviewRow({ ...review(2, 'item-2'), setBack: 1 }, context).note).toBe(
      'It set you back about 1 new review.',
    )
  })

  it('has no note while no count reaches the goal', () => {
    expect(lowReviewRow({ ...review(2, 'item-2'), setBack: null }, context)).toEqual({
      title: 'Read the 2★ review from Oct 12',
      note: null,
    })
  })

  it('names the year of a review from another year', () => {
    const old = review(1, 'item-1', '2025-12-30T10:00:00.000Z')

    expect(lowReviewRow(old, context).title).toBe('Read the 1★ review from Dec 30, 2025')
  })
})
