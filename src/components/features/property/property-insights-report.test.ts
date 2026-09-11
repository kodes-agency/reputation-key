import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PropertyInsightsRatingDistribution } from './property-insights-rating-distribution'

// The report's own evidence states (degraded window, provisional figures) are
// covered by `property-insights-report.stories.tsx` under a real router, which
// the page now needs for its breadcrumb. Asserting the same copy twice — once
// against static markup, once in the browser — only doubled the maintenance.

const PARTIAL_BASIS = {
  reviewCount: 20,
  analyzedReviewCount: 18,
  preAspectAnalysisCount: 0,
  currentAnalysisCount: 18,
  starOnlyCount: 0,
  notAnalyzableCount: 0,
  awaitingAnalysisCount: 2,
  ratingDistribution: [
    { stars: 1, count: 1 },
    { stars: 2, count: 2 },
    { stars: 3, count: 3 },
    { stars: 4, count: 6 },
    { stars: 5, count: 8 },
  ],
} as const

describe('PropertyInsightsRatingDistribution', () => {
  it('states how the complete review basis contributes to rating evidence', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsRatingDistribution, { basis: PARTIAL_BASIS }),
    )

    expect(markup).toContain('Rating distribution')
    expect(markup).toContain('Every review in the basis is included here')
  })
})
