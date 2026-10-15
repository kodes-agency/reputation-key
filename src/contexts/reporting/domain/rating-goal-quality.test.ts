import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  bestYear,
  minimumQualityTenths,
  nearestTenth,
  qualityChoice,
  qualityProblem,
  type QualityEvidence,
} from './rating-goal-quality'

/** The beta property of 2026-10-15: last 25 at 3.92, 2024 = 26 reviews at 4.46. */
const BETA_EVIDENCE: QualityEvidence = {
  recentMix: ratio(98, 25),
  bestYear: { year: 2024, average: ratio(116, 26), reviewCount: 26 },
}

const kindsAndTenths = (choice: ReturnType<typeof qualityChoice>['options']) =>
  choice.map(({ kind, qualityTenths }) => [kind, qualityTenths])

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

describe('the quality options of a target', () => {
  it('drops the recent mix below the floor and recommends the best year', () => {
    // The beta property, 3.9 → 4.0: 3.9 < 4.1 is dropped; 4.3 · 4.5 (rec) · 4.8.
    const choice = qualityChoice(BETA_EVIDENCE, 40)

    expect(kindsAndTenths(choice.options)).toEqual([
      ['step_above', 43],
      ['best_year', 45],
      ['excellent', 48],
    ])
    expect(choice.recommended).toEqual({
      kind: 'best_year',
      qualityTenths: 45,
      year: 2024,
    })
    expect(choice.minimumTenths).toBe(41)
  })

  it('recommends the recent mix when it clears the floor', () => {
    const choice = qualityChoice(
      {
        recentMix: ratio(47, 10),
        bestYear: { ...BETA_EVIDENCE.bestYear!, average: ratio(19, 4) },
      },
      45,
    )

    // 4.75 and the step above (4.8) and Excellent (4.8) are one tenth: the best year keeps it.
    expect(kindsAndTenths(choice.anchors)).toEqual([
      ['like_now', 47],
      ['best_year', 48],
    ])
    expect(choice.recommended.kind).toBe('like_now')
    expect(kindsAndTenths(choice.options)).toEqual([
      ['like_now', 47],
      ['best_year', 48],
    ])
  })

  it('recommends a step above what the target needs without other evidence', () => {
    const choice = qualityChoice({ recentMix: null, bestYear: null }, 40)

    // θ 3.95 + 0.3 = 4.25, rounded up to 4.3.
    expect(choice.recommended).toEqual({
      kind: 'step_above',
      qualityTenths: 43,
      year: null,
    })
    expect(kindsAndTenths(choice.options)).toEqual([
      ['step_above', 43],
      ['excellent', 48],
    ])
  })

  it('keeps the recommendation in the middle with its nearest anchors', () => {
    const choice = qualityChoice(
      { recentMix: ratio(44, 10), bestYear: BETA_EVIDENCE.bestYear },
      40,
    )

    expect(kindsAndTenths(choice.anchors)).toEqual([
      ['step_above', 43],
      ['like_now', 44],
      ['best_year', 45],
      ['excellent', 48],
    ])
    expect(kindsAndTenths(choice.options)).toEqual([
      ['step_above', 43],
      ['like_now', 44],
      ['best_year', 45],
    ])
  })

  it('fills three options from one side when the other has none', () => {
    // 4.5 needs 4.6 or more: the recent mix 4.6 is the lowest anchor.
    const choice = qualityChoice(
      {
        recentMix: ratio(46, 10),
        bestYear: { year: 2023, average: ratio(47, 10), reviewCount: 40 },
      },
      45,
    )

    expect(kindsAndTenths(choice.options)).toEqual([
      ['like_now', 46],
      ['best_year', 47],
      ['step_above', 48],
    ])
  })

  it('keeps Excellent exactly at the floor and drops it above', () => {
    expect(qualityChoice({ recentMix: null, bestYear: null }, 47).anchors).toContainEqual(
      {
        kind: 'excellent',
        qualityTenths: 48,
        year: null,
      },
    )
    expect(
      qualityChoice({ recentMix: null, bestYear: null }, 48).anchors.map((a) => a.kind),
    ).toEqual(['step_above'])
  })

  it('caps a step above at five stars, which still clears the floor of 4.9', () => {
    const choice = qualityChoice({ recentMix: null, bestYear: null }, 49)

    expect(choice.anchors).toEqual([
      { kind: 'step_above', qualityTenths: 50, year: null },
    ])
    expect(choice.recommended.qualityTenths).toBe(50)
  })

  it('lets the earlier kind keep a tenth two anchors share', () => {
    // The recent mix 4.3 is the step above 4.0: "Like now" keeps it.
    const choice = qualityChoice({ recentMix: ratio(43, 10), bestYear: null }, 40)

    expect(kindsAndTenths(choice.anchors)).toEqual([
      ['like_now', 43],
      ['excellent', 48],
    ])
  })
})
