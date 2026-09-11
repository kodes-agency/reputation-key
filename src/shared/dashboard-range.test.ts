import { describe, expect, it } from 'vitest'
import { timeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_DEFAULT,
  bucketUnitForRange,
  dashboardRangeComparisonLabel,
  dashboardRangeDays,
  dashboardRangeSearch,
  toInsightsRange,
  toPerformancePreset,
} from './dashboard-range'

describe('dashboardRangeSearch', () => {
  it('falls back to the default rather than rejecting a hand-edited URL', () => {
    expect(dashboardRangeSearch.parse(undefined)).toBe(DASHBOARD_RANGE_DEFAULT)
    expect(dashboardRangeSearch.parse('7d')).toBe(DASHBOARD_RANGE_DEFAULT)
    // The retired numeric vocabulary from `/insights?range=90`.
    expect(dashboardRangeSearch.parse(90)).toBe(DASHBOARD_RANGE_DEFAULT)
  })

  it('keeps every shared preset', () => {
    for (const range of DASHBOARD_RANGES) {
      expect(dashboardRangeSearch.parse(range)).toBe(range)
    }
  })
})

describe('adapters', () => {
  it('passes every shared range straight through the reporting preset', () => {
    // The ratings page uses the shared range as its query key with no
    // conversion; that only holds while the reporting enum is a superset.
    for (const range of DASHBOARD_RANGES) {
      expect(timeRangePreset.parse(range)).toBe(range)
    }
  })

  it('clamps an unbounded range to what Google can answer', () => {
    expect(toPerformancePreset('all')).toBe('180d')
    expect(toPerformancePreset('30d')).toBe('30d')
    expect(toPerformancePreset('180d')).toBe('180d')
  })

  it('converts to the AI contexts numeric range', () => {
    expect(toInsightsRange('30d')).toBe(30)
    expect(toInsightsRange('90d')).toBe(90)
    expect(toInsightsRange('180d')).toBe(180)
    expect(toInsightsRange('all')).toBe('all')
  })
})

describe('range semantics', () => {
  it('has no day count and no comparison for the unbounded window', () => {
    // An unbounded window has no prior window; inventing one is what produced
    // the fabricated 0 % trend this codebase already fixed once.
    expect(dashboardRangeDays('all')).toBeNull()
    expect(dashboardRangeComparisonLabel('all')).toBeNull()
  })

  it('compares a bounded window with one of the same length', () => {
    expect(dashboardRangeDays('180d')).toBe(180)
    expect(dashboardRangeComparisonLabel('30d')).toBe('vs the previous 30 days')
    expect(dashboardRangeComparisonLabel('180d')).toBe('vs the previous 6 months')
  })

  it('widens the bucket as the window grows', () => {
    expect(bucketUnitForRange('30d')).toBe('day')
    expect(bucketUnitForRange('90d')).toBe('week')
    expect(bucketUnitForRange('180d')).toBe('week')
    expect(bucketUnitForRange('all')).toBe('month')
  })
})
