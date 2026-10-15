import { describe, expect, it } from 'vitest'
import {
  MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL,
  perfectStop,
  ratingGoalEligibility,
  stopLabel,
} from './rating-goal-stops'

describe('the label of a target', () => {
  it('draws the Realistic line at 26 weeks and the Stretch line at 52, at the Faster pace', () => {
    expect(stopLabel(286, 11)).toBe('realistic')
    expect(stopLabel(287, 11)).toBe('stretch')
    expect(stopLabel(572, 11)).toBe('stretch')
    expect(stopLabel(573, 11)).toBe('out_of_reach')
  })

  it('is out of reach when no count of reviews gets there', () => {
    expect(stopLabel('unreachable', 11)).toBe('out_of_reach')
  })
})

describe('5.0', () => {
  it('is offered only as a disabled stop with its reason', () => {
    expect(perfectStop(43)).toEqual({
      targetTenths: 50,
      disabledReason: 'needs_every_review_5_star',
    })
    expect(perfectStop(50)).toBeNull()
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
