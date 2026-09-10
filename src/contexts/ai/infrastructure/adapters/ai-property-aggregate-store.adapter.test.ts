import { describe, expect, it } from 'vitest'
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
