import { describe, expect, it } from 'vitest'
import type { PerformanceSeries } from '#/shared/google-performance-report-contract'
import { buildGooglePerformanceChartModel } from './google-performance-chart'

const series: readonly PerformanceSeries[] = [
  {
    id: 'website-clicks',
    label: 'Website clicks',
    points: [
      { localDate: '2026-01-05', value: 2, availability: 'returned' },
      { localDate: '2026-01-06', value: 3, availability: 'returned' },
      { localDate: '2026-01-19', value: 5, availability: 'returned' },
      { localDate: '2026-01-26', value: 7, availability: 'returned' },
    ],
  },
  {
    id: 'call-clicks',
    label: 'Call clicks',
    points: [
      { localDate: '2026-01-05', value: null, availability: 'unavailable' },
      { localDate: '2026-01-06', value: 4, availability: 'returned' },
      { localDate: '2026-01-19', value: 6, availability: 'returned' },
      { localDate: '2026-01-26', value: 8, availability: 'returned' },
    ],
  },
]

describe('buildGooglePerformanceChartModel', () => {
  it('rolls up only complete buckets so an omitted day remains a visible gap', () => {
    const model = buildGooglePerformanceChartModel(series, '90d', 'actions')

    expect(model.unit).toBe('week')
    expect(model.rows).toEqual([
      {
        start: '2026-01-05',
        label: '5 Jan 2026',
        series0: 5,
        series1: null,
      },
      {
        start: '2026-01-12',
        label: '12 Jan',
        series0: null,
        series1: null,
      },
      {
        start: '2026-01-19',
        label: '19 Jan',
        series0: 5,
        series1: 6,
      },
      {
        start: '2026-01-26',
        label: '26 Jan',
        series0: 7,
        series1: 8,
      },
    ])
    expect(model.hasEnoughEvidence).toBe(true)
    expect(model.caption).toBe(
      '31 actions across 3 weeks; unavailable values remain gaps.',
    )
  })

  it('uses monthly buckets for the all-time reading even though Google fetches six months', () => {
    const model = buildGooglePerformanceChartModel(series, 'all', 'actions')

    expect(model.unit).toBe('month')
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]?.series0).toBe(17)
    expect(model.rows[0]?.series1).toBeNull()
  })
})
