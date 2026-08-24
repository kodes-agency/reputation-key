import { describe, expect, it } from 'vitest'
import { buildPropertyReputationTrendData } from './property-reputation-trend-chart-data'

describe('buildPropertyReputationTrendData', () => {
  it('merges sparse rating and volume series by calendar date without dropping either day', () => {
    expect(
      buildPropertyReputationTrendData(
        [{ date: '2026-07-02', avgRating: 4.64 }],
        [{ date: '2026-07-01', count: 3 }],
      ),
    ).toEqual([
      { date: '2026-07-01', count: 3 },
      { date: '2026-07-02', avgRating: 4.6 },
    ])
  })

  it('combines values for the same day and sorts input deterministically', () => {
    expect(
      buildPropertyReputationTrendData(
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
      { date: '2026-07-01', count: 4, avgRating: 4.2 },
      { date: '2026-07-02', count: 2, avgRating: 3.9 },
    ])
  })
})
