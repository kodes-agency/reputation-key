import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AiPropertyInsightsPresetReady } from '#/contexts/ai/application/public-api'
import { PropertyGuestVoiceBasis } from './property-guest-voice-page'

const DISAGREEING_SOURCE_FIELDS: AiPropertyInsightsPresetReady = {
  status: 'ready',
  provisional: true,
  coverage: {
    settledAnalysisCount: 10,
    expectedAnalysisCount: 10,
    awaitingAnalysisCount: 0,
  },
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  dataThroughLocalDate: '2026-09-10',
  impactVersion: 'aspect-impact-v1',
  aspectEvidenceState: 'available',
  basis: {
    reviewCount: 39,
    analyzedReviewCount: 10,
    preAspectAnalysisCount: 5,
    currentAnalysisCount: 18,
    starOnlyCount: 12,
    notAnalyzableCount: 3,
    awaitingAnalysisCount: 9,
    ratingDistribution: [
      { stars: 1, count: 3 },
      { stars: 2, count: 4 },
      { stars: 3, count: 6 },
      { stars: 4, count: 11 },
      { stars: 5, count: 15 },
    ],
  },
  aspects: [],
  weeklyAspectSeries: [],
  emergingIssues: [],
}

describe('PropertyGuestVoiceBasis', () => {
  it('uses the basis counter for both filling-in status and its breakdown', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, { result: DISAGREEING_SOURCE_FIELDS }),
    )

    expect(markup).toContain('Based on 39 reviews · 10 analysed')
    expect(markup).toContain('9 reviews still being analysed')
    expect(markup).toMatch(/<dt>Awaiting analysis<\/dt><dd[^>]*>9<\/dd>/)
    expect(markup).not.toContain('0 reviews still being analysed')
    expect(markup).not.toMatch(/<dt>Awaiting analysis<\/dt><dd[^>]*>0<\/dd>/)
  })
})
