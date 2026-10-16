import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL,
  offerKeepFirst,
  planNeeds,
  ratingGoalEligibility,
} from './rating-goal-stops'

/** The beta property: 261 reviews averaging 1,021 / 261 = 3.9119, Google shows 3.9. */
const BETA = { reviewCount: 261, displayedTenths: 39, exact: ratio(1021, 261) }

describe('what a plan needs', () => {
  it('counts the reviews at its quality and the best case at five stars', () => {
    expect(planNeeds(BETA, 40, 45)).toEqual({ reviewsNeeded: 19, bestCase: 10 })
  })

  it('needs nothing when the exact average already meets the threshold', () => {
    expect(planNeeds({ ...BETA, exact: ratio(4351, 1000) }, 44, 47)).toEqual({
      reviewsNeeded: 0,
      bestCase: 0,
    })
  })
})

describe('when Keep is offered first', () => {
  it('is offered only when Google shows 4.9 or 5.0', () => {
    expect(offerKeepFirst(50)).toBe(true)
    expect(offerKeepFirst(49)).toBe(true)
    expect(offerKeepFirst(48)).toBe(false)
    expect(offerKeepFirst(39)).toBe(false)
  })
})

describe('who may set a rating goal', () => {
  it('needs ten Google reviews and says how many there are', () => {
    expect(MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL).toBe(10)
    expect(ratingGoalEligibility({ reviewCount: 6 }, true)).toEqual({
      eligible: false,
      reason: 'few_reviews',
      reviewCount: 6,
    })
    expect(ratingGoalEligibility({ reviewCount: 10 }, true)).toEqual({ eligible: true })
  })

  it('says how many reviews there are even while the numbers are not current', () => {
    // A Property with no Google review has no average, so its numbers never
    // become usable: it must still hear "You have 0", not "Waiting for Google".
    expect(ratingGoalEligibility({ reviewCount: 0 }, false)).toEqual({
      eligible: false,
      reason: 'few_reviews',
      reviewCount: 0,
    })
    expect(ratingGoalEligibility({ reviewCount: 6 }, false)).toEqual({
      eligible: false,
      reason: 'few_reviews',
      reviewCount: 6,
    })
  })

  it('waits for Google when there are no numbers yet, or they are not current', () => {
    expect(ratingGoalEligibility(null, false)).toEqual({
      eligible: false,
      reason: 'waiting_for_google',
    })
    expect(ratingGoalEligibility({ reviewCount: 10 }, false)).toEqual({
      eligible: false,
      reason: 'waiting_for_google',
    })
  })
})
