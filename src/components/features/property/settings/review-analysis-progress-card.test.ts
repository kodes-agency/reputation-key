import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ReviewAnalysisProgressCard,
  reviewAnalysisShare,
} from './review-analysis-progress-card'

describe('reviewAnalysisShare', () => {
  it('counts settled reviews, with and without a result, against everything known', () => {
    expect(
      reviewAnalysisShare({
        status: 'analysing',
        analysed: 30,
        notAnalysable: 10,
        queued: 55,
        inProgress: 5,
        verifiedThroughEpochMillis: null,
      }),
    ).toBe(0.4)
  })

  it('treats an empty caught-up property as complete and an empty analysing one as not started', () => {
    const empty = {
      analysed: 0,
      notAnalysable: 0,
      queued: 0,
      inProgress: 0,
      verifiedThroughEpochMillis: null,
    }
    expect(reviewAnalysisShare({ status: 'caught_up', ...empty })).toBe(1)
    expect(reviewAnalysisShare({ status: 'analysing', ...empty })).toBe(0)
    expect(reviewAnalysisShare({ status: 'needs_attention', ...empty })).toBe(0)
  })

  it('renders failed enrollment as needing attention instead of up to date', () => {
    const html = renderToStaticMarkup(
      createElement(ReviewAnalysisProgressCard, {
        progress: {
          status: 'needs_attention',
          analysed: 0,
          notAnalysable: 0,
          queued: 0,
          inProgress: 0,
          verifiedThroughEpochMillis: null,
        },
      }),
    )
    expect(html).toContain('Needs attention')
    expect(html).toContain('Review history could not be verified')
    expect(html).not.toContain('Up to date')
  })
})
