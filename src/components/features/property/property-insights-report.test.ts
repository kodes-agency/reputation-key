import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PropertyInsightsReport } from './property-insights-report'
import { PropertyInsightsRatingDistribution } from './property-insights-rating-distribution'

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

describe('PropertyInsightsReport evidence states', () => {
  it('renders a degraded state instead of zero figures for an empty window', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsReport, {
        propertyId: '11111111-1111-4111-8111-111111111111',
        propertyName: 'Harbour House Hotel',
        range: 90,
        onRangeChange: () => undefined,
        result: {
          status: 'insufficient_data',
          startLocalDate: '2026-06-13',
          endLocalDate: '2026-09-10',
        },
      }),
    )

    expect(markup).toContain('Not enough review evidence in this period')
    expect(markup).toContain('No reviews were found in the selected period')
    expect(markup).not.toContain('Based on 0 reviews')
    expect(markup).not.toContain('Aspect impact')
    expect(markup).not.toContain('Rating distribution')
  })

  it('labels partial figures and omits period-comparison claims', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsReport, {
        propertyId: '11111111-1111-4111-8111-111111111111',
        propertyName: 'Harbour House Hotel',
        range: 90,
        onRangeChange: () => undefined,
        result: {
          status: 'ready',
          provisional: true,
          coverage: {
            settledAnalysisCount: 18,
            expectedAnalysisCount: 20,
            awaitingAnalysisCount: 2,
          },
          range: 90,
          startLocalDate: '2026-06-13',
          endLocalDate: '2026-09-10',
          dataThroughLocalDate: '2026-09-10',
          impactVersion: 'aspect-impact-v1',
          basis: PARTIAL_BASIS,
          aspectEvidenceState: 'no_mentions',
          aspects: [],
          weeklyAspectSeries: [],
          emergingIssues: [],
        },
      }),
    )

    expect(markup).toContain('Provisional figures')
    expect(markup).toContain('Figures are still filling in')
    expect(markup).toContain('2 reviews awaiting analysis')
    expect(markup).toContain(
      'Comparison is unavailable while analysis is still filling in',
    )
    expect(markup).not.toContain('compared with the immediately preceding')
  })

  it('states how the complete review basis contributes to rating evidence', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsRatingDistribution, { basis: PARTIAL_BASIS }),
    )

    expect(markup).toContain('Rating distribution')
    expect(markup).toContain('Every review in the basis is included here')
  })
})
