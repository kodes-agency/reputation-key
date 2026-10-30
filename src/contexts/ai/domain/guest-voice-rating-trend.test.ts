import { describe, expect, it } from 'vitest'
import { ratingTrendVerdict, type RatingTrendStars } from './guest-voice-rating-trend'

const low: RatingTrendStars = [0, 0, 100, 0, 0]
const high: RatingTrendStars = [0, 0, 0, 0, 100]

describe('ratingTrendVerdict', () => {
  it.each([
    [low, high, 'improving'],
    [high, low, 'slipping'],
    [high, high, 'steady'],
    [[0, 0, 50, 0, 50], [0, 0, 0, 100, 0], 'steady'],
    [[0, 0, 10, 0, 90], [0, 0, 0, 100, 0], 'steady'],
  ] as const)(
    'compares happy share and requires mean agreement (%s → %s)',
    (beforeStars, recentStars, verdict) => {
      expect(
        ratingTrendVerdict({ beforeStars, recentStars, provisional: false }),
      ).toEqual({ verdict, reason: 'assessed' })
    },
  )
  it.each([
    [[0, 0, 19, 0, 0], high],
    [low, [0, 0, 0, 0, 9]],
  ] as const)(
    'withholds claims below either sample minimum',
    (beforeStars, recentStars) => {
      expect(
        ratingTrendVerdict({ beforeStars, recentStars, provisional: false }),
      ).toEqual({ verdict: 'not_enough', reason: 'too_few_reviews' })
    },
  )
  it('withholds a clear improvement while analysis is incomplete', () => {
    expect(
      ratingTrendVerdict({ beforeStars: low, recentStars: high, provisional: true }),
    ).toEqual({ verdict: 'not_enough', reason: 'analysis_incomplete' })
  })
  it('accepts exactly 10 recent and 20 before comments', () => {
    expect(
      ratingTrendVerdict({
        beforeStars: [0, 0, 20, 0, 0],
        recentStars: [0, 0, 0, 0, 10],
        provisional: false,
      }).verdict,
    ).toBe('improving')
  })
  it('includes an exact .20 mean difference, without floating point boundary loss', () => {
    // Before mean 4.4, recent 4.6; happy share .7 → 1, both ample.
    expect(
      ratingTrendVerdict({
        beforeStars: [0, 0, 300, 0, 700],
        recentStars: [0, 0, 0, 400, 600],
        provisional: false,
      }).verdict,
    ).toBe('improving')
  })
})

it.each([
  [
    [0, 0, 300, 0, 700],
    [0, 0, 0, 401, 599],
  ],
  [
    [0, 0, 0, 401, 599],
    [0, 0, 300, 0, 700],
  ],
] as const)(
  'withholds a claim just under .20 mean movement despite a decisive happy-share change',
  (beforeStars, recentStars) => {
    expect(ratingTrendVerdict({ beforeStars, recentStars, provisional: false })).toEqual({
      verdict: 'steady',
      reason: 'assessed',
    })
  },
)
