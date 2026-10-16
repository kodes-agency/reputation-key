import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  currentPacePerWeek,
  MAX_PACE_TENTHS_PER_WEEK,
  MIN_PACE_TENTHS_PER_WEEK,
  isValidPaceTenths,
  legacyPacePerWeek,
  paceRatio,
} from './rating-goal-pace'

describe('the current pace', () => {
  it('is the reviews of the last 28 days per week', () => {
    expect(currentPacePerWeek(28)).toEqual(ratio(7, 1))
    // Beta property A: one review in 28 days is 0.25 a week.
    expect(currentPacePerWeek(1)).toEqual(ratio(1, 4))
    expect(currentPacePerWeek(0)).toEqual(ratio(0, 1))
  })
})

describe('a pace in tenths of a review a week', () => {
  it('runs from 1 a week to 50 a day', () => {
    expect(MIN_PACE_TENTHS_PER_WEEK).toBe(10)
    expect(MAX_PACE_TENTHS_PER_WEEK).toBe(3500)
    expect(isValidPaceTenths(10)).toBe(true)
    expect(isValidPaceTenths(3500)).toBe(true)
    expect(isValidPaceTenths(9)).toBe(false)
    expect(isValidPaceTenths(3501)).toBe(false)
    expect(isValidPaceTenths(14.5)).toBe(false)
  })

  it('is a ratio of reviews a week', () => {
    expect(paceRatio(105)).toEqual(ratio(21, 2))
    expect(paceRatio(70)).toEqual(ratio(7, 1))
  })

  it('mirrors as whole reviews a week, half up and at least one', () => {
    // The same table runs against the database CHECK (repository test).
    const mirrors = [
      [10, 1],
      [14, 1],
      [15, 2],
      [105, 11],
      [3500, 350],
    ] as const
    for (const [tenths, perWeek] of mirrors) {
      expect(legacyPacePerWeek(tenths)).toBe(perWeek)
    }
  })
})
