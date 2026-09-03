import { describe, expect, it } from 'vitest'
import { ratingPresentation } from './rating-presentation'

describe('ratingPresentation', () => {
  it('renders no eligible rating as unavailable, never zero stars', () => {
    expect(
      ratingPresentation(
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
      ratingPresentation(
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

  it('uses a typographic minus for a rating decline', () => {
    expect(
      ratingPresentation(
        { value: 4, comparison: -0.4, sampleCount: 12, priorSampleCount: 12 },
        '30d',
      ).comparison,
    ).toBe('−0.4')
  })

  it('keeps All Time absolute and non-comparative', () => {
    expect(
      ratingPresentation(
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
