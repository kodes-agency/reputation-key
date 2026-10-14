import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DISPLAY_ROUNDING,
  displayedTenths,
  exactAverage,
  ratio,
  ratioToNumber,
  recentMix,
  reviewsNeeded,
  bestCaseReviewsNeeded,
  thresholdThousandths,
} from './rating-goal-numbers'

// The worked example of ADR 0067: 812 Google reviews at an exact 4.31, a
// recent mix of 4.70.
const EXAMPLE = {
  reviewCount: 812,
  exact: ratio(431, 100),
  mix: ratio(470, 100),
}

describe('the number Google shows', () => {
  it('rounds half up to one decimal under the named rule', () => {
    expect(GOOGLE_DISPLAY_ROUNDING).toBe('half_up')
    expect(displayedTenths(4.45)).toBe(45)
    expect(displayedTenths(4.449)).toBe(44)
    expect(displayedTenths(4.31)).toBe(43)
    expect(displayedTenths(5)).toBe(50)
    expect(displayedTenths(1)).toBe(10)
  })

  it('reads the float32 artefacts Google sends as the decimal they stand for', () => {
    // Beta fact (ADR 0067): 3.9 arrives stored as 3.9000000953674316.
    expect(displayedTenths(3.9000000953674316)).toBe(39)
    // 4.45 as a float32 is 4.449999809265137; it still shows 4.5.
    expect(displayedTenths(Math.fround(4.45))).toBe(45)
  })

  it('rounds a figure just below the half down, as half up does', () => {
    // Read to the thousandth first, 4.4496 would become 4.450 and show 4.5.
    expect(displayedTenths(4.4496)).toBe(44)
    expect(displayedTenths(Math.fround(4.4499))).toBe(44)
    expect(displayedTenths(Math.fround(4.4496))).toBe(44)
    expect(displayedTenths(4.44999)).toBe(44)
  })

  it('places each target threshold five hundredths below the tenth', () => {
    expect(thresholdThousandths(45)).toBe(4450)
    expect(thresholdThousandths(44)).toBe(4350)
    expect(thresholdThousandths(50)).toBe(4950)
  })
})

describe('the exact average a goal plans against', () => {
  it('takes the cache sum over count when the cache holds every Google review', () => {
    const exact = exactAverage(
      { count: 261, sum: 1021 },
      { reviewCount: 261, averageRating: 3.9000000953674316 },
    )

    expect(exact).toEqual({ value: ratio(1021, 261), source: 'cache' })
    expect(ratioToNumber(exact!.value)).toBeCloseTo(3.9119, 4)
  })

  it("falls back to Google's figure when the cache is short of Google's count", () => {
    const exact = exactAverage(
      { count: 250, sum: 1000 },
      { reviewCount: 261, averageRating: 3.9000000953674316 },
    )

    expect(exact).toEqual({ value: ratio(3900, 1000), source: 'google' })
  })

  it('has no basis when neither the cache nor Google has a rating', () => {
    expect(
      exactAverage({ count: 0, sum: 0 }, { reviewCount: 0, averageRating: null }),
    ).toBeNull()
  })
})

describe('the recent star mix', () => {
  it('averages the last 90 days when they hold at least ten reviews', () => {
    const mix = recentMix({ count: 10, sum: 47 }, { count: 25, sum: 110 })

    expect(mix).toEqual({ value: ratio(47, 10), reviewCount: 10, basis: 'last_90_days' })
  })

  it('falls back to the most recent reviews when 90 days hold fewer than ten', () => {
    // Beta property A: only 8 reviews in 90 days.
    const mix = recentMix({ count: 8, sum: 32 }, { count: 25, sum: 98 })

    expect(mix).toEqual({ value: ratio(98, 25), reviewCount: 25, basis: 'most_recent' })
  })

  it('uses all the reviews there are when there are fewer than 25', () => {
    const mix = recentMix({ count: 3, sum: 15 }, { count: 19, sum: 95 })

    expect(mix).toEqual({ value: ratio(95, 19), reviewCount: 19, basis: 'most_recent' })
  })

  it('has no mix without a review in the cache', () => {
    expect(recentMix({ count: 0, sum: 0 }, { count: 0, sum: 0 })).toBeNull()
  })
})

describe('reviews needed to reach a target', () => {
  it('pins the worked example for every tenth', () => {
    expect(reviewsNeeded({ ...EXAMPLE, thresholdThousandths: 4350 })).toBe(93)
    expect(reviewsNeeded({ ...EXAMPLE, thresholdThousandths: 4450 })).toBe(455)
    // 812 × 0.24 / 0.15 = 1299.2, so 1300 reviews.
    expect(reviewsNeeded({ ...EXAMPLE, thresholdThousandths: 4550 })).toBe(1300)
    expect(reviewsNeeded({ ...EXAMPLE, thresholdThousandths: 4750 })).toBe('unreachable')
  })

  it('pins the best case when every new review is five stars', () => {
    expect(bestCaseReviewsNeeded({ ...EXAMPLE, thresholdThousandths: 4450 })).toBe(207)
  })

  it('needs none when the exact average already meets the threshold', () => {
    expect(
      reviewsNeeded({
        reviewCount: 100,
        exact: ratio(4460, 1000),
        mix: ratio(470, 100),
        thresholdThousandths: 4450,
      }),
    ).toBe(0)
  })

  it('is unreachable when the mix sits exactly on the threshold', () => {
    expect(
      reviewsNeeded({
        reviewCount: 261,
        exact: ratio(1021, 261),
        mix: ratio(3950, 1000),
        thresholdThousandths: 3950,
      }),
    ).toBe('unreachable')
  })

  it('stays exact where floating point would land a hair above a whole number', () => {
    // 100 × (4.45 − 4.35) / (4.55 − 4.45) is exactly 100; floats give 100.00000000000001.
    expect(
      reviewsNeeded({
        reviewCount: 100,
        exact: ratio(435, 100),
        mix: ratio(455, 100),
        thresholdThousandths: 4450,
      }),
    ).toBe(100)
  })
})
