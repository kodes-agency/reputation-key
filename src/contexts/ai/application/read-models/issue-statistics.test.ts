import { describe, expect, it } from 'vitest'
import { issueStatistics, type WindowFacts } from './issue-statistics'

// 128 reviews with text and 96 with only stars in the window; 480 with text before it.
const HOTEL: WindowFacts = {
  textReviews: 128,
  allReviews: 224,
  stars: [12, 14, 20, 60, 118],
  baselineReviews: 480,
}

describe('issueStatistics', () => {
  it('works the agreed design’s top problem out as the engine does', () => {
    const statistics = issueStatistics(HOTEL, { stars: [7, 6, 4, 2, 0], before: 36 })

    expect(statistics).toMatchObject({
      reviewCount: 19,
      textReviewCount: 128,
      allReviewCount: 224,
      shareText: '19 of 128',
      sharePercent: 15,
      upTo: 0.2,
      change: 'rising',
      evidenceLevel: 'likely',
    })
    expect(statistics.mentionedAverage).toBeCloseTo(39 / 19, 10)
    // "The rest" is every other review of the window, those with only stars too.
    expect(statistics.othersAverage).toBeCloseTo((930 - 39) / (224 - 19), 10)
    expect(statistics.gap).toBeCloseTo(
      (statistics.othersAverage ?? 0) - (statistics.mentionedAverage ?? 0),
      10,
    )
  })

  it('weighs the gap by every review in the window, so a rarer problem is worth less', () => {
    const common = issueStatistics(HOTEL, { stars: [7, 6, 4, 2, 0], before: 36 })
    const rare = issueStatistics(HOTEL, { stars: [1, 2, 0, 0, 0], before: 5 })

    expect(rare.upTo).toBe(0.05)
    expect(rare.upTo).toBeLessThan(common.upTo ?? 0)
  })

  it('names no stars at stake under three reviews, and calls the evidence too thin', () => {
    const one = issueStatistics(HOTEL, { stars: [0, 1, 0, 0, 0] })

    expect(one.upTo).toBeNull()
    expect(one.mentionedAverage).toBe(2)
    expect(one.evidenceLevel).toBe('not_enough')
  })

  it('sees nothing at stake in praise: reviews that rate above the rest are no cost', () => {
    const praise = issueStatistics(HOTEL, { stars: [0, 1, 3, 26, 64], before: 340 })

    expect(praise.upTo).toBe(0)
    expect(praise.gap).toBeLessThan(0)
  })

  it('prints a percent only above 20 reviews with text', () => {
    const small: WindowFacts = {
      textReviews: 19,
      allReviews: 30,
      stars: [2, 3, 5, 8, 12],
      baselineReviews: 0,
    }

    expect(issueStatistics(small, { stars: [1, 1, 1, 0, 0] }).sharePercent).toBeNull()
    expect(
      issueStatistics({ ...small, textReviews: 20 }, { stars: [1, 1, 1, 0, 0] }),
    ).toMatchObject({ sharePercent: 15, shareText: '3 of 20' })
  })

  it('judges no change without 20 reviews with text in the 12 months before', () => {
    const young: WindowFacts = { ...HOTEL, baselineReviews: 12 }

    const statistics = issueStatistics(young, { stars: [7, 6, 4, 2, 0], before: 36 })

    expect(statistics.change).toBe('unknown')
    expect(statistics.evidenceLevel).toBe('early')
  })

  it('refuses nothing for a window with no reviews of an issue', () => {
    const none = issueStatistics(HOTEL, { stars: [0, 0, 0, 0, 0] })

    expect(none).toMatchObject({
      reviewCount: 0,
      shareText: '0 of 128',
      mentionedAverage: null,
      upTo: null,
      evidenceLevel: 'not_enough',
    })
  })
})
