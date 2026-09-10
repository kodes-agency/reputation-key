import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PropertyInsightsReport } from './property-insights-report'

describe('PropertyInsightsReport evidence states', () => {
  it('renders a degraded state instead of zero figures for an empty window', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsReport, {
        propertyId: '11111111-1111-4111-8111-111111111111',
        propertyName: 'Harbour House Hotel',
        rangeDays: 90,
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
})
