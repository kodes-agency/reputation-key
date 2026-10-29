import { describe, expect, it } from 'vitest'
import {
  GUEST_VOICE_STATISTICS_VERSION,
  PERCENT_MIN_REVIEWS,
  baselineRate,
  chooseEvidenceWindow,
  evidenceLevel,
  likelyChange,
  regularizedIncompleteBeta,
  shareText,
  starsWhenMentioned,
} from './guest-voice-statistics'

describe('regularizedIncompleteBeta', () => {
  it.each([
    { x: 0.37, a: 1, b: 1, expected: 0.37 },
    { x: 0.5, a: 2, b: 3, expected: 0.6875 },
    { x: 0.3, a: 2, b: 5, expected: 0.579825 },
  ])('computes I_$x($a, $b)', ({ x, a, b, expected }) => {
    expect(Math.abs(regularizedIncompleteBeta(x, a, b) - expected)).toBeLessThanOrEqual(
      1e-9,
    )
  })

  it('uses the complementary beta distribution symmetrically', () => {
    const x = 0.73
    const direct = regularizedIncompleteBeta(x, 2.5, 4.25)
    const complement = regularizedIncompleteBeta(1 - x, 4.25, 2.5)

    expect(Math.abs(direct - (1 - complement))).toBeLessThanOrEqual(1e-12)
  })

  it('returns exact values at the endpoints', () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0)
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1)
  })

  it.each([
    { x: -0.01, a: 2, b: 3 },
    { x: 1.01, a: 2, b: 3 },
    { x: Number.NaN, a: 2, b: 3 },
    { x: 0.5, a: 0, b: 3 },
    { x: 0.5, a: 2, b: -1 },
    { x: 0.5, a: Number.POSITIVE_INFINITY, b: 3 },
  ])('rejects values outside the beta domain', ({ x, a, b }) => {
    expect(() => regularizedIncompleteBeta(x, a, b)).toThrow(RangeError)
  })
})

describe('chooseEvidenceWindow', () => {
  it('selects the shortest window that reaches the default target', () => {
    expect(
      chooseEvidenceWindow({ '30d': 25, '90d': 60, '180d': 85, '365d': 120 }),
    ).toEqual({ window: '90d', enough: true })
  })

  it('accepts a custom evidence target', () => {
    expect(
      chooseEvidenceWindow({ '30d': 25, '90d': 60, '180d': 85, '365d': 120 }, 75),
    ).toEqual({ window: '180d', enough: true })
  })

  it('falls back to 365 days and reports insufficient annual evidence', () => {
    expect(chooseEvidenceWindow({ '30d': 1, '90d': 3, '180d': 6, '365d': 9 })).toEqual({
      window: '365d',
      enough: false,
    })
  })
})

describe('baselineRate', () => {
  it('applies the Jeffreys-style smoothing contract', () => {
    expect(baselineRate(2, 20)).toBeCloseTo(0.11904761904761904, 15)
  })
})

describe('likelyChange', () => {
  it('keeps a constant rate steady with twenty current reviews', () => {
    expect(
      likelyChange({
        mentions: 2,
        textReviews: 20,
        baselineMentions: 1,
        baselineReviews: 14,
      }),
    ).toBe('steady')
  })

  it('detects a likely rise from ten to sixty percent', () => {
    expect(
      likelyChange({
        mentions: 12,
        textReviews: 20,
        baselineMentions: 1,
        baselineReviews: 14,
      }),
    ).toBe('rising')
  })

  it('detects a likely fall to zero mentions', () => {
    expect(
      likelyChange({
        mentions: 0,
        textReviews: 60,
        baselineMentions: 20,
        baselineReviews: 120,
      }),
    ).toBe('falling')
  })

  it.each([
    { textReviews: 9, baselineReviews: 100 },
    { textReviews: 100, baselineReviews: 9 },
  ])(
    'returns unknown when either evidence period is too small',
    ({ textReviews, baselineReviews }) => {
      expect(
        likelyChange({
          mentions: 1,
          textReviews,
          baselineMentions: 1,
          baselineReviews,
        }),
      ).toBe('unknown')
    },
  )
})

describe('evidenceLevel', () => {
  it.each([
    { mentions: 2, textReviews: 30, change: 'rising' as const },
    { mentions: 4, textReviews: 9, change: 'rising' as const },
  ])('requires minimum mention and review counts', (input) => {
    expect(evidenceLevel(input)).toBe('not_enough')
  })

  it.each([
    { mentions: 4, textReviews: 20, change: 'rising' as const },
    { mentions: 4, textReviews: 20, change: 'falling' as const },
  ])('reports likely evidence for a supported change', (input) => {
    expect(evidenceLevel(input)).toBe('likely')
  })

  it.each([
    { mentions: 3, textReviews: 20, change: 'rising' as const },
    { mentions: 4, textReviews: 19, change: 'rising' as const },
    { mentions: 4, textReviews: 20, change: 'steady' as const },
  ])('reports early evidence before every likely condition is met', (input) => {
    expect(evidenceLevel(input)).toBe('early')
  })
})

describe('starsWhenMentioned', () => {
  it('reports clamped averages, their gap, and the rounded upside', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [1, 2, 3],
        otherRatings: [4, 5],
        allReviewsInWindow: 40,
      }),
    ).toEqual({ mentionedAverage: 2, othersAverage: 4.5, gap: 2.5, upTo: 0.2 })
  })

  it('clamps ratings to the one-to-five range', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [0, 3, 6],
        otherRatings: [-2, 10],
        allReviewsInWindow: 5,
      }),
    ).toEqual({ mentionedAverage: 3, othersAverage: 3, gap: 0, upTo: 0 })
  })

  it('uses null averages and derived values for empty samples', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [],
        otherRatings: [4],
        allReviewsInWindow: 1,
      }),
    ).toEqual({
      mentionedAverage: null,
      othersAverage: 4,
      gap: null,
      upTo: null,
    })
  })

  it('uses null derived values when the comparison sample is empty', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [2, 3, 4],
        otherRatings: [],
        allReviewsInWindow: 3,
      }),
    ).toEqual({
      mentionedAverage: 3,
      othersAverage: null,
      gap: null,
      upTo: null,
    })
  })

  it('withholds upside until at least three reviews mention the aspect', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [1, 2],
        otherRatings: [5],
        allReviewsInWindow: 3,
      }),
    ).toEqual({ mentionedAverage: 1.5, othersAverage: 5, gap: 3.5, upTo: null })
  })

  it('never presents a negative star upside', () => {
    expect(
      starsWhenMentioned({
        mentionedRatings: [5, 5, 5],
        otherRatings: [2, 3],
        allReviewsInWindow: 5,
      }),
    ).toEqual({ mentionedAverage: 5, othersAverage: 2.5, gap: -2.5, upTo: 0 })
  })
})

describe('guest voice display contract', () => {
  it('pins the statistics algorithm version', () => {
    expect(GUEST_VOICE_STATISTICS_VERSION).toBe('guest-voice-statistics-v1')
  })

  it('pins the minimum review count for percentages', () => {
    expect(PERCENT_MIN_REVIEWS).toBe(20)
  })

  it('formats review share as counts without a percentage or noun', () => {
    expect(shareText(3, 17)).toBe('3 of 17')
  })
})
