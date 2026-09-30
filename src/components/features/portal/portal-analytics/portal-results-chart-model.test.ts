import { describe, expect, it } from 'vitest'
import { averageDomain, chartModel, niceScale } from './portal-results-chart-model'
import { RESULTS_HEALTHY } from './portal-results-stories-data'

const SERIES = RESULTS_HEALTHY.series
const MARKERS = RESULTS_HEALTHY.versionMarkers
if (SERIES === null) throw new Error('fixture has a series')

describe('niceScale', () => {
  it('rounds the top of the axis up to a round step with at most four intervals', () => {
    expect(niceScale(108)).toEqual({ ceiling: 150, ticks: [0, 50, 100, 150] })
    expect(niceScale(25)).toEqual({ ceiling: 30, ticks: [0, 10, 20, 30] })
    expect(niceScale(7)).toEqual({ ceiling: 8, ticks: [0, 2, 4, 6, 8] })
  })

  it('keeps an empty axis drawable', () => {
    expect(niceScale(0)).toEqual({ ceiling: 4, ticks: [0, 1, 2, 3, 4] })
  })

  it('stays exact at a round maximum', () => {
    expect(niceScale(100)).toEqual({ ceiling: 100, ticks: [0, 50, 100] })
  })
})

describe('averageDomain', () => {
  it('reads 3 to 5 stars when every average is at or above 3', () => {
    expect(averageDomain([4.4, 4.3])).toEqual({ low: 3, high: 5, ticks: [5, 4, 3] })
  })

  it('reaches down to the lowest whole star when an average falls below 3', () => {
    expect(averageDomain([4.4, 2.6])).toEqual({ low: 2, high: 5, ticks: [5, 4, 3, 2] })
  })

  it('has a default range while no average is shown', () => {
    expect(averageDomain([])).toEqual({ low: 3, high: 5, ticks: [5, 4, 3] })
  })
})

describe('chartModel', () => {
  const model = chartModel(SERIES, MARKERS)

  it('labels each bucket by its own days, the last one shorter', () => {
    expect(model.columns.map((column) => column.label)).toEqual([
      '1–7 Sep',
      '8–14 Sep',
      '15–21 Sep',
      '22–28 Sep',
      '29–30 Sep',
    ])
  })

  it('scales the bars of both periods on one axis, the larger filling its share', () => {
    expect(model.scans.ceiling).toBe(150)
    const first = model.columns[0]
    expect(first?.scansPercent).toBeCloseTo((108 / 150) * 100)
    expect(first?.priorScansPercent).toBeCloseTo((86 / 150) * 100)
  })

  it('puts an average near the top of its axis and leaves a withheld one off, with a note', () => {
    const [first, , , , last] = model.columns
    expect(first?.averageFromTop).toBeCloseTo(((5 - 4.4) / 2) * 100)
    expect(first?.averageNote).toBeNull()
    expect(last?.averageFromTop).toBeNull()
    expect(last?.averageNote).toBe('4 ratings, too few')
  })

  it('places a version marker on its day within its bucket, with its own words', () => {
    // Week 3 of 5, first day: 3/5 of the way across.
    expect(model.markers).toEqual([
      { key: 'v5-2026-09-22', label: 'v5 published 22 Sep', leftPercent: 60 },
    ])
  })

  it('says a rollback made an earlier version live again', () => {
    const rolled = chartModel(SERIES, [
      {
        version: 3,
        kind: 'rollback',
        activatedAt: new Date('2026-09-10T06:00:00.000Z'),
        localDate: '2026-09-10',
        week: 1,
        dayInWeek: 2,
      },
    ])

    expect(rolled.markers[0]?.label).toBe('v3 made live again 10 Sep')
    expect(rolled.markers[0]?.leftPercent).toBeCloseTo(((1 + 2 / 7) / 5) * 100)
  })

  it('draws no prior bars when the series carries no prior figure', () => {
    const off = chartModel(
      { weeks: SERIES.weeks.map((week) => ({ ...week, priorScans: null })) },
      [],
    )

    expect(off.hasPrior).toBe(false)
    expect(off.columns.every((column) => column.priorScansPercent === null)).toBe(true)
    expect(off.scans.ceiling).toBe(150)
  })

  it('draws no bar for scans that are not known, rather than an empty one', () => {
    const unknown = chartModel(
      { weeks: SERIES.weeks.map((week) => ({ ...week, scans: null, priorScans: null })) },
      [],
    )

    expect(unknown.columns.every((column) => column.scansPercent === null)).toBe(true)
  })
})
