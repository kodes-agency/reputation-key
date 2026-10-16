import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  bestYear,
  minimumQualityTenths,
  nearestTenth,
  qualityProblem,
} from './rating-goal-quality'

describe('the floor a planned quality must clear', () => {
  it('is 0.15★ above the target’s threshold, as a tenth', () => {
    // 4.0 shows from 3.95, so new reviews must average 4.10 or more.
    expect(minimumQualityTenths(40)).toBe(41)
    expect(minimumQualityTenths(45)).toBe(46)
    expect(minimumQualityTenths(49)).toBe(50)
  })

  it('accepts a whole tenth from the floor to five stars', () => {
    expect(qualityProblem(40, 41)).toBeNull()
    expect(qualityProblem(40, 50)).toBeNull()
  })

  it('refuses a quality below the floor, above five stars or between tenths', () => {
    expect(qualityProblem(40, 40)).toBe('invalid_quality')
    expect(qualityProblem(45, 45)).toBe('invalid_quality')
    expect(qualityProblem(40, 51)).toBe('invalid_quality')
    expect(qualityProblem(40, 42.5)).toBe('invalid_quality')
  })
})

describe('a tenth from an average', () => {
  it('rounds half up, exactly', () => {
    expect(nearestTenth(ratio(116, 26))).toBe(45) // 4.4615
    expect(nearestTenth(ratio(98, 25))).toBe(39) // 3.92
    expect(nearestTenth(ratio(445, 100))).toBe(45)
    expect(nearestTenth(ratio(4449, 1000))).toBe(44)
    expect(nearestTenth(ratio(5, 1))).toBe(50)
  })
})

describe('the best year', () => {
  it('is the calendar year with the highest average among those with ten reviews', () => {
    const best = bestYear([
      { year: 2021, count: 35, sum: 153 }, // 4.371
      { year: 2024, count: 26, sum: 116 }, // 4.462
      { year: 2025, count: 9, sum: 45 }, // five stars, too few
    ])

    expect(best).toEqual({ year: 2024, average: ratio(116, 26), reviewCount: 26 })
  })

  it('takes the later year when two average the same', () => {
    const best = bestYear([
      { year: 2022, count: 10, sum: 45 },
      { year: 2023, count: 20, sum: 90 },
    ])

    expect(best?.year).toBe(2023)
  })

  it('is none without a year of ten reviews', () => {
    expect(bestYear([{ year: 2025, count: 9, sum: 40 }])).toBeNull()
    expect(bestYear([])).toBeNull()
  })
})
