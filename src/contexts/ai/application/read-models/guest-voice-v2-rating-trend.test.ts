import { describe, expect, it } from 'vitest'
import { addDays } from '../local-date'
import {
  ratingComparisonPeriods,
  ratingMonthSeries,
  buildRatingTrend,
} from './guest-voice-v2-rating-trend'
import { population, review } from './guest-voice-v2.test-fixtures'

describe('fixed rating periods and calendar series', () => {
  it.each([
    [30, 7],
    [90, 22],
    [180, 45],
    [365, 90],
  ])('splits %i inclusive days into a fixed recent %i', (days, recentDays) => {
    const endLocalDate = '2026-10-30'
    const split = ratingComparisonPeriods({
      startLocalDate: addDays(endLocalDate, -(days - 1)),
      endLocalDate,
    })
    expect(split.recent.startLocalDate).toBe(addDays(endLocalDate, -(recentDays - 1)))
    expect(split.before.endLocalDate).toBe(addDays(split.recent.startLocalDate, -1))
  })
  it('includes 13 overlapping months, leap February, gaps and exact edge bounds', () => {
    const months = ratingMonthSeries([], {
      startLocalDate: '2023-10-31',
      endLocalDate: '2024-10-29',
    })
    expect(months).toHaveLength(13)
    expect(months[0]).toMatchObject({
      month: '2023-10',
      partialStart: true,
      partialEnd: false,
      startLocalDate: '2023-10-31',
    })
    expect(months.find((m) => m.month === '2024-02')).toMatchObject({
      endLocalDate: '2024-02-29',
      partialStart: false,
      partialEnd: false,
      averageStars: null,
      reviewCount: 0,
    })
    expect(months.at(-1)).toMatchObject({ partialEnd: true, endLocalDate: '2024-10-29' })
  })
  it('uses raw comment ratings including unanalysed comments, excluding star-only and outside days', () => {
    const raw = population([
      review(1, { rating: 1 }),
      review(2, { rating: 5 }),
      review(3, { rating: 5 }),
    ])
    const trend = buildRatingTrend(
      [
        ...raw,
        { ...raw[0]!, hasText: false },
        ...population([review(4, { localDate: '2026-07-31' })]),
      ],
      { startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' },
      false,
    )
    expect(trend.months[0]).toMatchObject({
      reviewCount: 3,
      averageStars: 11 / 3,
      happyReviewCount: 2,
      partialEnd: false,
    })
    expect(trend.recent.reviewCount + trend.before.reviewCount).toBe(3)
    expect(trend.population).toBe('current_reviews_with_text')
  })
})
