import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL,
  offerKeepFirst,
  perfectStop,
  preselectedTarget,
  ratingGoalEligibility,
  ratingStops,
} from './rating-goal-stops'

const EXAMPLE = {
  reviewCount: 812,
  displayedTenths: 43,
  exact: ratio(431, 100),
  mix: ratio(470, 100),
}

describe('the target stops a manager can pick', () => {
  it('labels every tenth from the next one to 4.9 at the Faster pace', () => {
    const stops = ratingStops(EXAMPLE, 11)

    expect(stops).toEqual([
      { targetTenths: 44, reviewsNeeded: 93, bestCase: 50, label: 'realistic' },
      { targetTenths: 45, reviewsNeeded: 455, bestCase: 207, label: 'stretch' },
      { targetTenths: 46, reviewsNeeded: 1300, bestCase: 434, label: 'out_of_reach' },
      { targetTenths: 47, reviewsNeeded: 5522, bestCase: 789, label: 'out_of_reach' },
      {
        targetTenths: 48,
        reviewsNeeded: 'unreachable',
        bestCase: 1430,
        label: 'out_of_reach',
      },
      {
        targetTenths: 49,
        reviewsNeeded: 'unreachable',
        bestCase: 2924,
        label: 'out_of_reach',
      },
    ])
  })

  it('draws the Realistic line at 26 weeks and the Stretch line at 52', () => {
    // With E = 4.35, θ = 4.45 and m = 4.55 the next tenth needs exactly N
    // reviews, so N reviews at 11 a week take N / 11 weeks.
    const nextStop = (reviewCount: number) =>
      ratingStops(
        {
          reviewCount,
          displayedTenths: 44,
          exact: ratio(435, 100),
          mix: ratio(455, 100),
        },
        11,
      )[0]

    expect(nextStop(286)).toMatchObject({ reviewsNeeded: 286, label: 'realistic' })
    expect(nextStop(287)?.label).toBe('stretch')
    expect(nextStop(572)?.label).toBe('stretch')
    expect(nextStop(573)?.label).toBe('out_of_reach')
  })

  it('offers 5.0 only as a disabled stop with its reason', () => {
    expect(perfectStop(43)).toEqual({
      targetTenths: 50,
      disabledReason: 'needs_every_review_5_star',
    })
    expect(perfectStop(50)).toBeNull()
  })

  it('has no stop when Google already shows 4.9 or more', () => {
    expect(ratingStops({ ...EXAMPLE, displayedTenths: 49 }, 11)).toEqual([])
    expect(ratingStops({ ...EXAMPLE, displayedTenths: 50 }, 11)).toEqual([])
  })
})

describe('the target a picker opens on', () => {
  it('preselects the highest Realistic stop up to three tenths above', () => {
    expect(preselectedTarget(43, ratingStops(EXAMPLE, 11))).toBe(44)
  })

  it('caps the preselection at three tenths above what Google shows', () => {
    const stops = [44, 45, 46, 47].map((targetTenths) => ({
      targetTenths,
      reviewsNeeded: 1,
      bestCase: 1,
      label: 'realistic' as const,
    }))

    expect(preselectedTarget(43, stops)).toBe(46)
  })

  it('falls back to the next tenth when no stop is Realistic', () => {
    const stops = ratingStops({ ...EXAMPLE, mix: ratio(436, 100) }, 11)

    expect(stops.every((stop) => stop.label !== 'realistic')).toBe(true)
    expect(preselectedTarget(43, stops)).toBe(44)
  })

  it('has nothing to preselect without a stop', () => {
    expect(preselectedTarget(50, [])).toBeNull()
  })
})

describe('when Keep comes first', () => {
  it('comes first when Google already shows 4.9 or 5.0', () => {
    // Beta property B: 19 reviews, all five stars.
    expect(
      offerKeepFirst({
        reviewCount: 19,
        displayedTenths: 50,
        exact: ratio(5, 1),
        mix: ratio(5, 1),
      }),
    ).toBe(true)
    expect(offerKeepFirst({ ...EXAMPLE, displayedTenths: 49 })).toBe(true)
  })

  it('comes first when the recent mix does not clear the next threshold', () => {
    // Beta property A: shows 3.9, a recent mix of 3.92 against 3.95.
    expect(
      offerKeepFirst({
        reviewCount: 261,
        displayedTenths: 39,
        exact: ratio(1021, 261),
        mix: ratio(98, 25),
      }),
    ).toBe(true)
  })

  it('stays second when the next tenth is in reach', () => {
    expect(offerKeepFirst(EXAMPLE)).toBe(false)
  })
})

describe('who may set a rating goal', () => {
  it('needs ten Google reviews and says how many there are', () => {
    expect(MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL).toBe(10)
    expect(ratingGoalEligibility({ reviewCount: 6 })).toEqual({
      eligible: false,
      reason: 'few_reviews',
      reviewCount: 6,
    })
    expect(ratingGoalEligibility({ reviewCount: 10 })).toEqual({ eligible: true })
  })

  it('waits for Google when there are no numbers yet', () => {
    expect(ratingGoalEligibility(null)).toEqual({
      eligible: false,
      reason: 'waiting_for_google',
    })
  })
})
