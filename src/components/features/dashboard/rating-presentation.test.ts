import { describe, expect, it } from 'vitest'
import { ratingPresentation } from './rating-presentation'

describe('ratingPresentation', () => {
  it('renders no eligible rating as unavailable, never zero stars', () => {
    expect(
      ratingPresentation(
        {
          value: null,
          comparison: null,
          comparisonWithheld: 'sample_too_small',
          sampleCount: 0,
          priorSampleCount: 0,
        },
        '30d',
      ),
    ).toEqual({
      label: 'Average private rating (n = 0)',
      value: '—',
      comparison: '—',
      direction: 'neutral',
      evidence: '0 eligible ratings. Not enough ratings in both periods to compare.',
    })
  })

  it('formats an absolute star delta rather than a percentage', () => {
    expect(
      ratingPresentation(
        { value: 4.5, comparison: 0.5, sampleCount: 10, priorSampleCount: 12 },
        '30d',
      ),
    ).toEqual({
      label: 'Average private rating (n = 10)',
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
      label: 'Average private rating (n = 1)',
      value: '4.0 / 5',
      comparison: '—',
      direction: 'neutral',
      evidence: '1 eligible rating. All-time view has no prior-period comparison.',
    })
  })

  it('always names the sample the average rests on, even with a thousand ratings', () => {
    expect(
      ratingPresentation(
        { value: 4.2, comparison: null, sampleCount: 1234, priorSampleCount: 0 },
        '30d',
      ).label,
    ).toBe('Average private rating (n = 1,234)')
  })

  it('decides a missing comparison from the server, not from a client floor', () => {
    // The server says why there is no comparison. The client holds no number of
    // its own to second-guess that with.
    expect(
      ratingPresentation(
        {
          value: 4.2,
          comparison: null,
          comparisonWithheld: 'sample_too_small',
          sampleCount: 40,
          priorSampleCount: 3,
        },
        '30d',
      ).evidence,
    ).toBe('40 eligible ratings. Not enough ratings in both periods to compare.')
    expect(
      ratingPresentation(
        { value: 4.2, comparison: 0.1, sampleCount: 6, priorSampleCount: 6 },
        '30d',
      ).evidence,
    ).toBe('6 eligible ratings. +0.1 stars vs prior period')
  })

  it('blames the check, not the sample, when a period is not ready', () => {
    const { evidence } = ratingPresentation(
      {
        value: 4.2,
        comparison: null,
        comparisonWithheld: 'evidence_not_ready',
        sampleCount: 40,
        priorSampleCount: 40,
      },
      '30d',
    )
    expect(evidence).toBe(
      '40 eligible ratings. No comparison while a period is still being checked.',
    )
    expect(evidence).not.toContain('Not enough')
  })

  it('does not invent a reason when the server gave none', () => {
    expect(
      ratingPresentation(
        { value: 4.2, comparison: null, sampleCount: 40, priorSampleCount: 40 },
        '30d',
      ).evidence,
    ).toBe('40 eligible ratings. No comparison available.')
  })
})
