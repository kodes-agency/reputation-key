import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuestVoiceRatingChart } from './guest-voice-rating-chart'
import { GuestVoiceRatingComparison } from './guest-voice-rating-comparison'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'
describe('honest chart scales and unavailable averages', () => {
  it('keeps a gap null and the last partial month explicitly dated and counted', () => {
    const markup = renderToStaticMarkup(
      createElement(GuestVoiceRatingChart, { months: HAMPTON_READ.ratingTrend.months }),
    )
    expect(markup).toContain('Oct: 1 review · through Oct 1')
    expect(markup).toContain('Monthly comment ratings')
    expect(markup).toContain('Not available')
    expect(markup).toContain('tabindex="0"')
    expect(markup).not.toContain('role="slider"')
  })
  it('draws exactly zero width at one star and says not available for a null mean', () => {
    const markup = renderToStaticMarkup(
      createElement(GuestVoiceRatingComparison, {
        comparison: {
          population: 'current_analysed_comments',
          mentionedCount: 1,
          otherCount: 0,
          mentionedAverage: 1,
          othersAverage: null,
        },
      }),
    )
    expect(markup).toContain('These guests: 1.0 stars · 1 review')
    expect(markup).toContain('Other guests: Not available · 0 reviews')
    expect(markup).toContain('style="width:0%"')
    expect(markup).toContain('— Not available')
    expect(markup).not.toContain('0.0★')
  })
})
