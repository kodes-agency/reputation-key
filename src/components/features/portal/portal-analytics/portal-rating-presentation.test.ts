import { describe, expect, it } from 'vitest'
import { portalRatingPresentation } from './portal-rating-presentation'

describe('portalRatingPresentation', () => {
  it('renders no eligible rating as unavailable, never zero stars', () => {
    expect(
      portalRatingPresentation(
        { value: null, comparison: null, sampleCount: 0, priorSampleCount: 0 },
        '30d',
      ),
    ).toEqual({
      value: '—',
      comparison: '—',
      direction: 'neutral',
      evidence: '0 eligible ratings. Comparison needs 10 ratings in each period.',
    })
  })

  it('formats an absolute star delta rather than a percentage', () => {
    expect(
      portalRatingPresentation(
        { value: 4.5, comparison: 0.5, sampleCount: 10, priorSampleCount: 12 },
        '30d',
      ),
    ).toEqual({
      value: '4.5 / 5',
      comparison: '+0.5',
      direction: 'up',
      evidence: '10 eligible ratings. +0.5 stars vs prior period',
    })
  })

  it('keeps All Time absolute and non-comparative', () => {
    expect(
      portalRatingPresentation(
        { value: 4, comparison: null, sampleCount: 1, priorSampleCount: 0 },
        'all',
      ),
    ).toEqual({
      value: '4.0 / 5',
      comparison: '—',
      direction: 'neutral',
      evidence: '1 eligible rating. All-time view has no prior-period comparison.',
    })
  })
})
