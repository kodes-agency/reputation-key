import { describe, expect, it } from 'vitest'
import { previewRatingGoalPace, ratingGoalPaceView } from './rating-goal-preview'

// The worked example as the setup read hands it to the page.
const INPUTS = {
  reviewCount: 812,
  exact: { num: 431, den: 100 },
  mix: { num: 47, den: 10 },
  reviewsLast28Days: 28,
  timezone: 'Europe/Sofia',
  asOf: '2026-10-14T12:00:00.000Z',
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

  it('says no pace reaches a target the recent mix does not clear', () => {
    expect(previewRatingGoalPace(INPUTS, 48, 200).forecast).toEqual({
      kind: 'unreachable',
    })
  })
})

describe('a chosen pace on the page', () => {
  it('reads per week, per month and per day, as the setup read words its paces', () => {
    expect(ratingGoalPaceView(11)).toEqual({ perWeek: 11, perMonth: 48, perDay: 1.6 })
    expect(ratingGoalPaceView(1)).toEqual({ perWeek: 1, perMonth: 4, perDay: 0.1 })
  })
})
