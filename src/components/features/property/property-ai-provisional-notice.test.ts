import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PropertyAiProvisionalNotice } from './property-ai-provisional-notice'

function renderNotice(awaitingAnalysisCount: number, comparisonsSuppressed = false) {
  return renderToStaticMarkup(
    createElement(PropertyAiProvisionalNotice, {
      coverage: { awaitingAnalysisCount },
      comparisonsSuppressed,
    }),
  )
}

describe('PropertyAiProvisionalNotice', () => {
  it('states the number of reviews awaiting analysis', () => {
    const markup = renderNotice(2)

    expect(markup).toContain('Provisional figures')
    expect(markup).toContain('Figures are still filling in. 2 reviews awaiting analysis.')
    expect(markup).not.toContain('Period-over-period comparisons')
  })

  it('uses singular review grammar and names a suppressed comparison', () => {
    const markup = renderNotice(1, true)

    expect(markup).toContain('1 review awaiting analysis')
    expect(markup).toContain(
      'Period-over-period comparisons are hidden until analysis is complete.',
    )
  })
})
