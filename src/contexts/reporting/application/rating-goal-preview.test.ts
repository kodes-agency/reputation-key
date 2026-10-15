import { describe, expect, it } from 'vitest'
import type { RatingGoalForecastInputs } from './dto/rating-goal.types'
import {
  previewRatingGoalPace,
  previewRatingGoalPlan,
  ratingGoalPaceView,
} from './rating-goal-preview'

// The worked example as the setup read hands it to the page.
const INPUTS: RatingGoalForecastInputs = {
  reviewCount: 812,
  displayedTenths: 43,
  exact: { num: 431, den: 100 },
  mix: { num: 47, den: 10 },
  bestYear: null,
  reviewsLast28Days: 28,
  timezone: 'Europe/Sofia',
  asOf: '2026-10-14T12:00:00.000Z',
}

/** The beta property of 2026-10-15, 3.9 from 261 reviews, about one review in 28 days. */
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

describe('a pace the manager types in', () => {
  it('is worked out per week, month and day with its forecast', () => {
    expect(previewRatingGoalPace(INPUTS, 44, 11)).toEqual({
      pace: { perWeek: 11, perMonth: 48, perDay: 1.6 },
      forecast: { kind: 'range', fromMonth: '2026-11', toMonth: '2027-01' },
      surgeCaution: false,
    })
  })

  it('cautions above twice the current pace', () => {
    expect(previewRatingGoalPace(INPUTS, 44, 15).surgeCaution).toBe(true)
  })

  it('works a target out at its own recommended quality, not the recent mix', () => {
    // 4.8 needs new reviews above 4.9: a step above, 5.0, so 1,430 reviews.
    expect(previewRatingGoalPace(INPUTS, 48, 200).forecast).toEqual({
      kind: 'range',
      fromMonth: '2026-11',
      toMonth: '2027-01',
    })
  })
})

describe('Build your own: a whole plan the manager puts together', () => {
  it('totals the reviews needed and the forecast, live', () => {
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 45,
        pacePerWeek: 2,
      }),
    ).toEqual({
      valid: true,
      reviewsNeeded: 19,
      bestCase: 10,
      pace: { perWeek: 2, perMonth: 9, perDay: 0.3 },
      forecast: { kind: 'range', fromMonth: '2026-12', toMonth: '2027-01' },
      surgeCaution: false,
    })
  })

  it('needs new reviews to clear the target’s threshold by 0.15★', () => {
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 40,
        pacePerWeek: 2,
      }),
    ).toEqual({
      valid: false,
      problems: [{ field: 'quality', code: 'quality_too_low', minimumTenths: 41 }],
    })
  })

  it('refuses a quality above five stars or between tenths', () => {
    const problem = { field: 'quality', code: 'quality_out_of_range', maximumTenths: 50 }

    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 51,
        pacePerWeek: 2,
      }),
    ).toEqual({ valid: false, problems: [problem] })
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 44.5,
        pacePerWeek: 2,
      }),
    ).toEqual({ valid: false, problems: [problem] })
  })

  it('needs a target above what Google shows and no higher than 4.9', () => {
    const outOfRange = {
      field: 'target',
      code: 'target_out_of_range',
      minimumTenths: 40,
      maximumTenths: 49,
    }

    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 39,
        qualityTenths: 45,
        pacePerWeek: 2,
      }),
    ).toEqual({ valid: false, problems: [outOfRange] })
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 50,
        qualityTenths: 50,
        pacePerWeek: 2,
      }),
    ).toEqual({ valid: false, problems: [outOfRange] })
  })

  it('needs a whole pace from 1 to 200 a week, and names every problem at once', () => {
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 40,
        pacePerWeek: 0,
      }),
    ).toEqual({
      valid: false,
      problems: [
        { field: 'quality', code: 'quality_too_low', minimumTenths: 41 },
        { field: 'pace', code: 'pace_out_of_range', minimum: 1, maximum: 200 },
      ],
    })
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 45,
        pacePerWeek: 201,
      }),
    ).toMatchObject({ valid: false })
  })

  it('cautions above twice the current pace', () => {
    expect(
      previewRatingGoalPlan(BETA, {
        targetTenths: 40,
        qualityTenths: 45,
        pacePerWeek: 3,
      }),
    ).toMatchObject({ valid: true, surgeCaution: true })
  })
})

describe('a chosen pace on the page', () => {
  it('reads per week, per month and per day, as the setup read words its paces', () => {
    expect(ratingGoalPaceView(11)).toEqual({ perWeek: 11, perMonth: 48, perDay: 1.6 })
    expect(ratingGoalPaceView(1)).toEqual({ perWeek: 1, perMonth: 4, perDay: 0.1 })
  })
})
