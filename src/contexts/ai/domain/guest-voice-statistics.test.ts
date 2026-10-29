import { describe, expect, it } from 'vitest'
import { DASHBOARD_GLOSSARY } from '#/shared/dashboard-glossary'
import {
  CHANGE_BASELINE_MIN_REVIEWS,
  GUEST_VOICE_STATISTICS_VERSION,
  PERCENT_MIN_REVIEWS,
  baselineRate,
  chooseEvidenceWindow,
  evidenceLevel,
  likelyChange,
  probabilityShareHigher,
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

describe('probabilityShareHigher', () => {
  const shares = (successes: number, trials: number) => ({ successes, trials })

  it('is even odds for two shares seen the same way', () => {
    expect(
      Math.abs(probabilityShareHigher(shares(7, 20), shares(7, 20)) - 0.5),
    ).toBeLessThanOrEqual(1e-12)
  })

  it('beats a flat share by the mean of the share that beats it', () => {
    // X ~ Beta(2, 1) has mean 2/3, and the chance it exceeds a flat share is that mean.
    expect(
      Math.abs(probabilityShareHigher(shares(1, 1), shares(0, 0)) - 2 / 3),
    ).toBeLessThanOrEqual(1e-12)
  })

  it('splits the odds between the two directions', () => {
    const forward = probabilityShareHigher(shares(9, 30), shares(14, 80))
    const backward = probabilityShareHigher(shares(14, 80), shares(9, 30))

    expect(Math.abs(forward + backward - 1)).toBeLessThanOrEqual(1e-12)
  })

  it('agrees with the incomplete beta where the baseline is known almost exactly', () => {
    // With 100,000 reviews behind it the baseline share is its observed 10%, so the
    // chance the window beats it is the upper tail of the window's own posterior.
    const exact = 1 - regularizedIncompleteBeta(0.1, 13, 49)

    expect(
      Math.abs(probabilityShareHigher(shares(12, 60), shares(10_000, 100_000)) - exact),
    ).toBeLessThanOrEqual(2e-4)
  })

  it('agrees with a numerical integral over the baseline share', () => {
    // The average, over the baseline share y, of the chance the window's share is
    // above y: the midpoint rule on y = 3t^2 - 2t^3, which flattens both ends of
    // the baseline's density.
    const current = shares(11, 40)
    const baseline = shares(31, 150)
    const steps = 4_000
    let weighted = 0
    let mass = 0
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps
      const y = 3 * t * t - 2 * t ** 3
      const density =
        y ** baseline.successes *
        (1 - y) ** (baseline.trials - baseline.successes) *
        (6 * t * (1 - t))
      mass += density
      weighted +=
        density *
        (1 -
          regularizedIncompleteBeta(
            y,
            current.successes + 1,
            current.trials - current.successes + 1,
          ))
    }

    expect(
      Math.abs(probabilityShareHigher(current, baseline) - weighted / mass),
    ).toBeLessThanOrEqual(1e-6)
  })

  it('stays accurate for thousands of reviews, where the first term is smaller than a double', () => {
    // Shares of 40% and 10% on 5,000 reviews each are some 37 standard errors apart.
    expect(
      probabilityShareHigher(shares(2_000, 5_000), shares(500, 5_000)),
    ).toBeGreaterThan(1 - 1e-9)
    expect(probabilityShareHigher(shares(500, 5_000), shares(2_000, 5_000))).toBeLessThan(
      1e-9,
    )
  })

  it.each([
    { current: { successes: 5, trials: 4 }, baseline: { successes: 1, trials: 9 } },
    { current: { successes: -1, trials: 4 }, baseline: { successes: 1, trials: 9 } },
    { current: { successes: 1.5, trials: 4 }, baseline: { successes: 1, trials: 9 } },
    {
      current: { successes: 1, trials: 4 },
      baseline: { successes: 1, trials: Number.NaN },
    },
  ])('rejects counts that cannot be a share', ({ current, baseline }) => {
    expect(() => probabilityShareHigher(current, baseline)).toThrow(RangeError)
  })
})

describe('likelyChange', () => {
  it('keeps a constant rate steady with twenty current reviews', () => {
    expect(
      likelyChange({
        mentions: 2,
        textReviews: 20,
        baselineMentions: 8,
        baselineReviews: 80,
      }),
    ).toBe('steady')
  })

  it('detects a likely rise from ten to sixty percent', () => {
    expect(
      likelyChange({
        mentions: 12,
        textReviews: 20,
        baselineMentions: 8,
        baselineReviews: 80,
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

  it('treats the baseline as uncertain too: a move the baseline alone could explain stays steady', () => {
    // 5 of 20 is a rise on the baseline's observed 10%, but 8 of 80 could be a true
    // 15% seen low, and a 25% window is not yet unusual against that.
    expect(
      likelyChange({
        mentions: 5,
        textReviews: 20,
        baselineMentions: 8,
        baselineReviews: 80,
      }),
    ).toBe('steady')
  })

  it.each([
    { textReviews: 9, baselineReviews: 100 },
    { textReviews: 100, baselineReviews: CHANGE_BASELINE_MIN_REVIEWS - 1 },
  ])(
    'returns unknown when either evidence period is too small',
    ({ textReviews, baselineReviews }) => {
      expect(
        likelyChange({
          mentions: 5,
          textReviews,
          baselineMentions: 1,
          baselineReviews,
        }),
      ).toBe('unknown')
    },
  )

  it('compares from twenty reviews in the 12 months before, the number the glossary tells a manager', () => {
    expect(CHANGE_BASELINE_MIN_REVIEWS).toBe(20)
    expect(DASHBOARD_GLOSSARY['likely-change'].definition).toContain(
      `at least ${CHANGE_BASELINE_MIN_REVIEWS} analysed reviews`,
    )
    expect(
      likelyChange({
        mentions: 12,
        textReviews: 20,
        baselineMentions: 2,
        baselineReviews: CHANGE_BASELINE_MIN_REVIEWS,
      }),
    ).toBe('rising')
  })

  it('needs three reviews for a rise and three in the baseline for a fall', () => {
    expect(
      likelyChange({
        mentions: 2,
        textReviews: 10,
        baselineMentions: 1,
        baselineReviews: 100,
      }),
    ).toBe('steady')
    expect(
      likelyChange({
        mentions: 0,
        textReviews: 200,
        baselineMentions: 2,
        baselineReviews: 20,
      }),
    ).toBe('steady')
    expect(
      likelyChange({
        mentions: 0,
        textReviews: 200,
        baselineMentions: 3,
        baselineReviews: 20,
      }),
    ).toBe('falling')
  })

  it('needs the share to have moved by the margin as well', () => {
    expect(
      likelyChange({
        mentions: 260,
        textReviews: 1_000,
        baselineMentions: 2_000,
        baselineReviews: 10_000,
        margin: 0.07,
      }),
    ).toBe('steady')
    expect(
      likelyChange({
        mentions: 260,
        textReviews: 1_000,
        baselineMentions: 2_000,
        baselineReviews: 10_000,
        margin: 0.05,
      }),
    ).toBe('rising')
  })

  it('says unknown, not a trend, for counts that cannot be a share', () => {
    expect(
      likelyChange({
        mentions: 25,
        textReviews: 20,
        baselineMentions: 8,
        baselineReviews: 80,
      }),
    ).toBe('unknown')
  })
})

// The enumeration behind the claim that an unchanged topic is rarely flagged: every
// pair of counts the two periods can show at one true rate, weighted by how likely
// the pair is, through the engine itself. No simulation, so the answer is exact and
// the test cannot flake.
function binomialMasses(trials: number, rate: number): readonly number[] {
  const masses: number[] = []
  let mass = (1 - rate) ** trials
  for (let successes = 0; successes <= trials; successes += 1) {
    masses.push(mass)
    mass *= ((trials - successes) * rate) / ((successes + 1) * (1 - rate))
  }
  return masses
}

function flaggedShares(
  windowRate: number,
  baselineRateOfTopic: number,
  textReviews: number,
  baselineReviews: number,
) {
  const windowMasses = binomialMasses(textReviews, windowRate)
  const baselineMasses = binomialMasses(baselineReviews, baselineRateOfTopic)
  const shares = { rising: 0, falling: 0, total: 0 }
  baselineMasses.forEach((baselineMass, baselineMentions) => {
    windowMasses.forEach((windowMass, mentions) => {
      const mass = baselineMass * windowMass
      shares.total += mass
      const change = likelyChange({
        mentions,
        textReviews,
        baselineMentions,
        baselineReviews,
      })
      if (change === 'rising' || change === 'falling') shares[change] += mass
    })
  })
  return shares
}

describe('likelyChange at a constant true rate', () => {
  it.each([
    { rate: 0.1, textReviews: 20 },
    { rate: 0.1, textReviews: 60 },
    { rate: 0.3, textReviews: 20 },
    { rate: 0.3, textReviews: 60 },
  ])(
    'flags a topic that did not change in at most 5% of windows ($rate, $textReviews reviews)',
    ({ rate, textReviews }) => {
      // The 12 months before a 30-day window hold far more reviews than it does;
      // four times as many is the least of the sizes the window choice produces.
      const { rising, falling, total } = flaggedShares(
        rate,
        rate,
        textReviews,
        textReviews * 4,
      )

      expect(Math.abs(total - 1)).toBeLessThanOrEqual(1e-9)
      expect(rising + falling).toBeLessThanOrEqual(0.05)
    },
  )

  it('still sees a share that tripled, in more than 9 windows in 10 at 60 reviews', () => {
    const { rising, falling } = flaggedShares(0.3, 0.1, 60, 240)

    expect(rising).toBeGreaterThan(0.9)
    expect(falling).toBeLessThan(0.001)
  })

  it('still sees a share that fell by two thirds, in more than 9 windows in 10 at 60 reviews', () => {
    const { rising, falling } = flaggedShares(0.1, 0.3, 60, 240)

    expect(falling).toBeGreaterThan(0.9)
    expect(rising).toBeLessThan(0.001)
  })
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
    expect(GUEST_VOICE_STATISTICS_VERSION).toBe('guest-voice-statistics-v2')
  })

  it('pins the minimum review count for percentages', () => {
    expect(PERCENT_MIN_REVIEWS).toBe(20)
  })

  it('formats review share as counts without a percentage or noun', () => {
    expect(shareText(3, 17)).toBe('3 of 17')
  })
})
