import { describe, expect, it } from 'vitest'
import type { RatingGoalForecastInputs } from './dto/rating-goal.types'
import {
  ratingGoalPlanning,
  ratingGoalPlansAt,
  ratingGoalQualityChoice,
  ratingGoalStops,
} from './rating-goal-planning'

/**
 * The beta property of 2026-10-15: 3.9 from 261 reviews (1,021 stars), the
 * last 25 at 3.92, 2024 = 26 reviews at 4.46, one review in 28 days.
 */
const BETA: RatingGoalForecastInputs = {
  reviewCount: 261,
  displayedTenths: 39,
  exact: { num: 1021, den: 261 },
  mix: { num: 98, den: 25 },
  bestYear: { year: 2024, average: { num: 58, den: 13 }, reviewCount: 26 },
  reviewsLast28Days: 1,
  timezone: 'Europe/Sofia',
  asOf: '2026-10-15T12:00:00.000Z',
}

describe('Pick a plan', () => {
  it('opens the beta property on 4.0 with plans that assume its best year', () => {
    const planning = ratingGoalPlanning(BETA)

    expect(planning).toMatchObject({
      recommendedTargetTenths: 40,
      recommendedPaceKey: 'faster',
      quality: {
        targetTenths: 40,
        minimumTenths: 41,
        recommended: {
          kind: 'best_year',
          qualityTenths: 45,
          quality: 4.5,
          year: 2024,
          recommended: true,
          reviewsNeeded: 19,
        },
      },
    })
    expect(
      planning?.quality.options.map(({ kind, qualityTenths, reviewsNeeded }) => [
        kind,
        qualityTenths,
        reviewsNeeded,
      ]),
    ).toEqual([
      ['step_above', 43, 29],
      ['best_year', 45, 19],
      ['excellent', 48, 12],
    ])
  })

  it('builds Cautious, Recommended and Ambitious on the one shared quality', () => {
    expect(ratingGoalPlanning(BETA)?.plans).toEqual([
      {
        key: 'cautious',
        targetTenths: 40,
        target: 4,
        qualityTenths: 45,
        quality: 4.5,
        paceKey: 'steady',
        pace: { perWeek: 1, perMonth: 4, perDay: 0.1 },
        reviewsNeeded: 19,
        bestCase: 10,
        forecast: { kind: 'range', fromMonth: '2027-01', toMonth: '2027-04' },
        reach: 'realistic',
      },
      {
        key: 'recommended',
        targetTenths: 40,
        target: 4,
        qualityTenths: 45,
        quality: 4.5,
        paceKey: 'faster',
        pace: { perWeek: 2, perMonth: 9, perDay: 0.3 },
        reviewsNeeded: 19,
        bestCase: 10,
        forecast: { kind: 'range', fromMonth: '2026-12', toMonth: '2027-01' },
        reach: 'realistic',
      },
      // 4.2 needs 178 reviews, 59 weeks at 3 a week: past a year. 4.1 needs
      // 81, 27 weeks, so the Ambitious plan stops there.
      {
        key: 'ambitious',
        targetTenths: 41,
        target: 4.1,
        qualityTenths: 45,
        quality: 4.5,
        paceKey: 'push',
        pace: { perWeek: 3, perMonth: 13, perDay: 0.4 },
        reviewsNeeded: 81,
        bestCase: 38,
        forecast: { kind: 'range', fromMonth: '2027-03', toMonth: '2027-07' },
        reach: 'stretch',
      },
    ])
  })

  it('says how far each plan is at its own pace, so a card can say "More than a year"', () => {
    // Ambitious: 81 reviews at 3 a week is 27 weeks, within the year.
    expect(ratingGoalPlanning(BETA)?.plans.map(({ key, reach }) => [key, reach])).toEqual(
      [
        ['cautious', 'realistic'],
        ['recommended', 'realistic'],
        ['ambitious', 'stretch'],
      ],
    )
  })

  it('never sets an Ambitious plan past a year while a nearer target is within reach', () => {
    const ambitious = ratingGoalPlanning(BETA)?.plans.find(
      (plan) => plan.key === 'ambitious',
    )

    expect(ambitious?.reach).not.toBe('out_of_reach')
    expect(ratingGoalStops(BETA).find((stop) => stop.targetTenths === 42)?.label).toBe(
      'out_of_reach',
    )
  })

  it('offers the target row with each stop’s label, the recommendation marked', () => {
    expect(ratingGoalPlanning(BETA)?.targets).toEqual([
      { targetTenths: 40, target: 4, label: 'realistic', recommended: true },
      { targetTenths: 41, target: 4.1, label: 'stretch', recommended: false },
      { targetTenths: 42, target: 4.2, label: 'out_of_reach', recommended: false },
    ])
  })

  it('offers no plans when Google shows 4.9 or 5.0: Keep is offered instead', () => {
    expect(ratingGoalPlanning({ ...BETA, displayedTenths: 49 })).toBeNull()
    expect(ratingGoalPlanning({ ...BETA, displayedTenths: 50 })).toBeNull()
  })
})

describe('changing the shared quality', () => {
  it('works the plans out again, the Ambitious target too', () => {
    const plans = ratingGoalPlansAt(BETA, 48)

    expect(
      plans?.map((plan) => [plan.key, plan.targetTenths, plan.reviewsNeeded]),
    ).toEqual([
      ['cautious', 40, 12],
      ['recommended', 40, 12],
      ['ambitious', 42, 96],
    ])
  })

  it('has no plans at a quality below the recommended target’s floor', () => {
    expect(ratingGoalPlansAt(BETA, 40)).toBeNull()
  })
})

describe('the quality row of another target', () => {
  it('drops what does not clear that target’s floor, a shared tenth kept once', () => {
    // 4.2 needs 4.3 or more; the best year (4.5) and a step above (4.5) share a tenth.
    const choice = ratingGoalQualityChoice(BETA, 42)

    expect(choice.minimumTenths).toBe(43)
    expect(
      choice.options.map(({ kind, qualityTenths }) => [kind, qualityTenths]),
    ).toEqual([
      ['best_year', 45],
      ['excellent', 48],
    ])
    expect(choice.recommended.kind).toBe('best_year')
  })
})

describe('every target at its own quality', () => {
  it('names each stop’s quality and forecasts it at the three paces', () => {
    const [first] = ratingGoalStops(BETA)

    expect(first).toEqual({
      targetTenths: 40,
      target: 4,
      qualityTenths: 45,
      quality: 4.5,
      qualityAnchor: 'best_year',
      reviewsNeeded: 19,
      bestCase: 10,
      label: 'realistic',
      forecasts: {
        steady: { kind: 'range', fromMonth: '2027-01', toMonth: '2027-04' },
        faster: { kind: 'range', fromMonth: '2026-12', toMonth: '2027-01' },
        push: expect.objectContaining({ kind: 'range' }),
      },
    })
  })
})
