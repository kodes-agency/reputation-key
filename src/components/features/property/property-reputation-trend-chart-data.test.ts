import { describe, expect, it } from 'vitest'
import {
  buildPropertyReputationTrendData,
  mergePropertyReputationDailyData,
} from './property-reputation-trend-chart-data'

describe('mergePropertyReputationDailyData', () => {
  it('keeps misaligned rating and volume dates instead of zipping unrelated days', () => {
    expect(
      mergePropertyReputationDailyData(
        [{ date: '2026-07-02', avgRating: 4.64 }],
        [{ date: '2026-07-01', count: 3 }],
      ),
    ).toEqual([
      { date: '2026-07-01', count: 3 },
      { date: '2026-07-02', avgRating: 4.64 },
    ])
  })

  it('combines observations for the same date and sorts them deterministically', () => {
    expect(
      mergePropertyReputationDailyData(
        [
          { date: '2026-07-02', avgRating: 3.94 },
          { date: '2026-07-01', avgRating: 4.15 },
        ],
        [
          { date: '2026-07-02', count: 2 },
          { date: '2026-07-01', count: 4 },
        ],
      ),
    ).toEqual([
      { date: '2026-07-01', count: 4, avgRating: 4.15 },
      { date: '2026-07-02', count: 2, avgRating: 3.94 },
    ])
  })
})

describe('buildPropertyReputationTrendData', () => {
  it('weights each bucket into a running average instead of plotting its isolated average', () => {
    const result = buildPropertyReputationTrendData(
      [
        { date: '2026-07-01', avgRating: 1 },
        { date: '2026-07-02', avgRating: 5 },
        { date: '2026-07-03', avgRating: 5 },
      ],
      [
        { date: '2026-07-01', count: 1 },
        { date: '2026-07-02', count: 1 },
        { date: '2026-07-03', count: 2 },
      ],
      'day',
    )

    expect(result.points).toEqual([
      { date: '2026-07-01', label: '1 Jul 2026', newReviews: 1, runningAverage: 1 },
      { date: '2026-07-02', label: '2 Jul', newReviews: 1, runningAverage: 3 },
      { date: '2026-07-03', label: '3 Jul', newReviews: 2, runningAverage: 4 },
    ])
    expect(result.points[1]?.runningAverage).not.toBe(5)
  })

  it('sums weekly volume, preserves quiet gaps, and carries the average forward', () => {
    const result = buildPropertyReputationTrendData(
      [
        { date: '2026-06-01', avgRating: 4 },
        { date: '2026-06-15', avgRating: 5 },
      ],
      [
        { date: '2026-06-01', count: 2 },
        { date: '2026-06-15', count: 2 },
      ],
      'week',
    )

    expect(result.points).toEqual([
      { date: '2026-06-01', label: '1 Jun 2026', newReviews: 2, runningAverage: 4 },
      { date: '2026-06-08', label: '8 Jun', newReviews: 0, runningAverage: 4 },
      { date: '2026-06-15', label: '15 Jun', newReviews: 2, runningAverage: 4.5 },
    ])
  })
})
