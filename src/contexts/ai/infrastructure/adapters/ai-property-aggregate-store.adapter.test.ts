import { describe, expect, it } from 'vitest'
import { dailyCountsFromReviews } from './ai-property-aggregate-window-mappers'
import { mapAnalyzedReview } from './ai-property-aggregate-store.adapter'

const V1_ROW = Object.freeze({
  reviewId: '75000000-0000-4000-8000-000000000003',
  sourceRevision: 1,
  analysisSequence: 1,
  localDate: '2026-09-07',
  rating: 5,
  sentiment: 'positive',
  attention: 'low',
  aspects: Object.freeze([]),
  issueLabel: null,
  analysisProfileVersion: 'review-analysis-v1',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  modelSnapshot: 'gpt-5-mini-2025-08-07',
})

describe('mapAnalyzedReview legacy evidence boundary', () => {
  it('keeps a valid v1 contribution with zero aspect children', () => {
    expect(mapAnalyzedReview(V1_ROW)).toMatchObject({
      reviewId: V1_ROW.reviewId,
      rating: 5,
      analysisProfileVersion: 'review-analysis-v1',
      aspects: [],
    })
  })

  it('does not treat a missing v2 aspect child as valid legacy evidence', () => {
    expect(() =>
      mapAnalyzedReview({ ...V1_ROW, analysisProfileVersion: 'review-analysis-v2' }),
    ).toThrow(/Property analyzed Review evidence is invalid/)
  })

  it.each([
    ['an unknown sentiment', { sentiment: 'cheerful' }],
    ['an out-of-range rating', { rating: 0 }],
    ['a blank model snapshot', { modelSnapshot: '' }],
  ])('still rejects %s', (_description, corruption) => {
    expect(() => mapAnalyzedReview({ ...V1_ROW, ...corruption })).toThrow(
      /Property analyzed Review evidence is invalid/,
    )
  })
})

describe('legacy daily reads from current contribution evidence', () => {
  it('counts reviews once per day and preserves sentiment, attention and aspect polarity totals', () => {
    const first = mapAnalyzedReview({
      ...V1_ROW,
      aspects: [{ aspect: 'service', polarity: 'positive', intensity: 75 }],
    })
    const second = mapAnalyzedReview({
      ...V1_ROW,
      reviewId: '75000000-0000-4000-8000-000000000004',
      rating: 2,
      sentiment: 'negative',
      attention: 'urgent',
      aspects: [{ aspect: 'service', polarity: 'negative', intensity: -75 }],
    })
    const tomorrow = { ...first, localDate: '2026-09-08' }
    expect(dailyCountsFromReviews([tomorrow, second, first])).toEqual([
      {
        localDate: '2026-09-07',
        reviewCount: 2,
        ratingSum: 7,
        sentimentCounts: { positive: 1, neutral: 0, negative: 1, mixed: 0 },
        attentionCounts: { urgent: 1, high: 0, medium: 0, low: 1 },
        aspectCounts: [
          { aspect: 'service', polarity: 'negative', count: 1 },
          { aspect: 'service', polarity: 'positive', count: 1 },
        ],
      },
      {
        localDate: '2026-09-08',
        reviewCount: 1,
        ratingSum: 5,
        sentimentCounts: { positive: 1, neutral: 0, negative: 0, mixed: 0 },
        attentionCounts: { urgent: 0, high: 0, medium: 0, low: 1 },
        aspectCounts: [{ aspect: 'service', polarity: 'positive', count: 1 }],
      },
    ])
    expect(dailyCountsFromReviews([first, { ...first }])[0]?.aspectCounts).toEqual([
      { aspect: 'service', polarity: 'positive', count: 2 },
    ])
    expect(dailyCountsFromReviews([])).toEqual([])
    expect(first.aspects).toHaveLength(1)
  })
})
