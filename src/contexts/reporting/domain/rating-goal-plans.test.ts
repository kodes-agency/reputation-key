import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import { paceSuggestions } from './rating-goal-pace'
import {
  offerKeepFirst,
  planNeeds,
  ratingPlans,
  ratingStops,
  recommendedTarget,
  targetRow,
  type PlanningBasis,
} from './rating-goal-plans'

/**
 * The beta property of 2026-10-15: 261 reviews averaging 1,021 / 261 = 3.9119
 * (Google shows 3.9), the last 25 at 3.92, 2024 = 26 reviews at 4.46, about
 * 0.4 a week (so the 1 / 2 / 3 floor).
 */
const BETA: PlanningBasis = {
  reviewCount: 261,
  displayedTenths: 39,
  exact: ratio(1021, 261),
  evidence: {
    recentMix: ratio(98, 25),
    bestYear: { year: 2024, average: ratio(116, 26), reviewCount: 26 },
  },
}

/** The worked example: 812 reviews at 3,500 / 812 = 4.31, a 4.70 mix, 7 a week. */
const EXAMPLE: PlanningBasis = {
  reviewCount: 812,
  displayedTenths: 43,
  exact: ratio(3500, 812),
  evidence: { recentMix: ratio(47, 10), bestYear: null },
}

const summary = (basis: PlanningBasis, faster: number) =>
  ratingStops(basis, faster).map((stop) => [
    stop.targetTenths,
    stop.qualityTenths,
    stop.reviewsNeeded,
    stop.label,
  ])

describe('the target stops, each at its own recommended quality', () => {
  it('works the beta property’s stops out at its best year, then a step above', () => {
    // 4.0: (261 × 3.95 − 1,021) / (4.5 − 3.95) = 18.09, so 19.
    expect(summary(BETA, 2)).toEqual([
      [40, 45, 19, 'realistic'],
      [41, 45, 81, 'stretch'],
      [42, 45, 178, 'out_of_reach'],
      [43, 45, 353, 'out_of_reach'],
      [44, 45, 763, 'out_of_reach'],
      // 4.5 needs 4.6 or more: 4.5 is dropped, a step above (4.8) leads.
      [45, 48, 402, 'out_of_reach'],
      [46, 49, 476, 'out_of_reach'],
      [47, 50, 551, 'out_of_reach'],
      [48, 50, 875, 'out_of_reach'],
      [49, 50, 1633, 'out_of_reach'],
    ])
  })

  it('works the worked example out at the recent mix while it clears the floor', () => {
    expect(summary(EXAMPLE, 11)).toEqual([
      [44, 47, 92, 'realistic'],
      [45, 47, 454, 'stretch'],
      [46, 47, 1298, 'out_of_reach'],
      [47, 50, 788, 'out_of_reach'],
      [48, 50, 1428, 'out_of_reach'],
      [49, 50, 2922, 'out_of_reach'],
    ])
    expect(ratingStops(EXAMPLE, 11)[0]).toMatchObject({
      qualityAnchor: 'like_now',
      bestCase: 50,
    })
  })

  it('has no stop when Google already shows 4.9 or more', () => {
    expect(ratingStops({ ...EXAMPLE, displayedTenths: 49 }, 11)).toEqual([])
    expect(ratingStops({ ...EXAMPLE, displayedTenths: 50 }, 11)).toEqual([])
  })
})

describe('the recommended target', () => {
  it('opens the beta property on 4.0, Realistic', () => {
    expect(recommendedTarget(39, ratingStops(BETA, 2))).toBe(40)
  })

  it('is the highest Realistic stop up to three tenths above what Google shows', () => {
    // At 30 a week 4.4 (92) and 4.5 (454) are both within 26 weeks.
    expect(recommendedTarget(43, ratingStops(EXAMPLE, 30))).toBe(45)
  })

  it('caps the recommendation at three tenths above what Google shows', () => {
    expect(recommendedTarget(43, ratingStops(EXAMPLE, 10_000))).toBe(46)
  })

  it('falls back to the next tenth when no stop is Realistic', () => {
    const stops = ratingStops(EXAMPLE, 1)

    expect(stops.every((stop) => stop.label !== 'realistic')).toBe(true)
    expect(recommendedTarget(43, stops)).toBe(44)
  })

  it('has nothing to recommend without a stop', () => {
    expect(recommendedTarget(50, [])).toBeNull()
  })
})

describe('the target row of Build your own', () => {
  it('runs from the next tenth when that is the recommendation', () => {
    expect(targetRow(39, 40)).toEqual([40, 41, 42])
  })

  it('puts the recommendation in the middle otherwise', () => {
    expect(targetRow(43, 45)).toEqual([44, 45, 46])
  })

  it('stops at 4.9', () => {
    expect(targetRow(47, 48)).toEqual([48, 49])
    expect(targetRow(46, 49)).toEqual([48, 49])
    expect(targetRow(48, 49)).toEqual([49])
  })
})

describe('the three plans', () => {
  it('share one quality and differ in target and pace', () => {
    const plans = ratingPlans({
      displayedTenths: 39,
      recommendedTenths: 40,
      qualityTenths: 45,
      paces: paceSuggestions(1),
    })

    expect(plans).toEqual([
      {
        key: 'cautious',
        targetTenths: 40,
        qualityTenths: 45,
        paceKey: 'steady',
        pacePerWeek: 1,
      },
      {
        key: 'recommended',
        targetTenths: 40,
        qualityTenths: 45,
        paceKey: 'faster',
        pacePerWeek: 2,
      },
      // 4.5★ clears 4.2's threshold 4.15 by 0.35: the row's upper option.
      {
        key: 'ambitious',
        targetTenths: 42,
        qualityTenths: 45,
        paceKey: 'push',
        pacePerWeek: 3,
      },
    ])
  })

  it('aims the Ambitious plan at the highest row target the quality clears by 0.15★', () => {
    // 4.7★ clears 4.6 (θ 4.55) by exactly 0.15.
    const plans = ratingPlans({
      displayedTenths: 43,
      recommendedTenths: 44,
      qualityTenths: 47,
      paces: paceSuggestions(28),
    })

    expect(plans.find((plan) => plan.key === 'ambitious')).toMatchObject({
      targetTenths: 46,
      pacePerWeek: 14,
    })
  })

  it('keeps the recommended target at Push when the quality clears no higher one', () => {
    // 4.6★ clears 4.5 (θ 4.45) by 0.15, but not 4.6 (θ 4.55).
    const plans = ratingPlans({
      displayedTenths: 44,
      recommendedTenths: 45,
      qualityTenths: 46,
      paces: paceSuggestions(28),
    })

    expect(plans.find((plan) => plan.key === 'ambitious')).toMatchObject({
      targetTenths: 45,
      paceKey: 'push',
    })
  })
})

describe('what a plan needs', () => {
  it('counts the reviews at its quality and the best case at five stars', () => {
    expect(planNeeds(BETA, 40, 45)).toEqual({ reviewsNeeded: 19, bestCase: 10 })
  })

  it('needs nothing when the exact average already meets the threshold', () => {
    expect(planNeeds({ ...EXAMPLE, exact: ratio(4351, 1000) }, 44, 47)).toEqual({
      reviewsNeeded: 0,
      bestCase: 0,
    })
  })
})

describe('when Keep is offered', () => {
  it('is offered only when Google shows 4.9 or 5.0', () => {
    expect(offerKeepFirst(50)).toBe(true)
    expect(offerKeepFirst(49)).toBe(true)
  })

  it('is not offered below 4.9, even where the recent mix trails the next tenth', () => {
    expect(offerKeepFirst(48)).toBe(false)
    expect(offerKeepFirst(39)).toBe(false)
  })
})
