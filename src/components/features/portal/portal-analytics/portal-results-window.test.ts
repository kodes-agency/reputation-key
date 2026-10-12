import { describe, expect, it } from 'vitest'
import { DASHBOARD_RANGE_LABELS } from '#/shared/dashboard-range'
import {
  PORTAL_OVERVIEW_RANGES,
  PORTAL_RESULTS_RANGES,
  compareLabel,
  currentPeriodLabel,
  dayCount,
  formatDayRange,
  priorPeriodLabel,
  storedOverviewRange,
  storedResultsRange,
  windowCaption,
  windowFooter,
  zoneTimeLabel,
} from './portal-results-window'

describe('formatDayRange', () => {
  it('writes a range inside one month as "1–30 Sep"', () => {
    expect(formatDayRange('2026-09-01', '2026-09-30')).toBe('1–30 Sep')
  })

  it('names both months when the range crosses one', () => {
    expect(formatDayRange('2026-08-28', '2026-09-03')).toBe('28 Aug – 3 Sep')
  })

  it('adds the year only when the range crosses a year', () => {
    expect(formatDayRange('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 – 3 Jan 2026')
  })

  it('writes a single day as one date', () => {
    expect(formatDayRange('2026-09-30', '2026-09-30')).toBe('30 Sep')
  })

  it('does not depend on the reader locale for month names', () => {
    // en-GB prints "Sept"; the boards say "Sep".
    expect(formatDayRange('2026-09-01', '2026-09-07')).toBe('1–7 Sep')
  })
})

describe('dayCount', () => {
  it('counts both ends of an inclusive local-day range', () => {
    expect(dayCount('2026-09-01', '2026-09-30')).toBe(30)
    expect(dayCount('2026-08-02', '2026-08-31')).toBe(30)
    expect(dayCount('2026-09-30', '2026-09-30')).toBe(1)
  })
})

describe('the window texts', () => {
  const days = {
    start: '2026-09-01',
    end: '2026-09-30',
    compareStart: '2026-08-02',
    compareEnd: '2026-08-31',
  }

  it('names the window and the Property zone it was cut in, as a place', () => {
    expect(windowCaption(days, 'Europe/Sofia')).toBe('1–30 Sep, Sofia time')
    expect(windowCaption(days, 'America/New_York')).toBe('1–30 Sep, New York time')
  })

  it('says what the comparison is against', () => {
    expect(compareLabel(days)).toBe('Compare with the 30 days before')
  })

  it('says the same in the singular for a one-day window', () => {
    expect(compareLabel({ ...days, start: '2026-09-30', end: '2026-09-30' })).toBe(
      'Compare with the day before',
    )
  })

  it('names the periods in the legend and the table from the days the figures cover', () => {
    expect(currentPeriodLabel(days)).toBe('Last 30 days')
    expect(priorPeriodLabel(days)).toBe('The 30 days before')
    const week = {
      ...days,
      start: '2026-09-24',
      compareStart: '2026-09-17',
      compareEnd: '2026-09-23',
    }
    expect(currentPeriodLabel(week)).toBe('Last 7 days')
    expect(priorPeriodLabel(week)).toBe('The 7 days before')
    expect(priorPeriodLabel({ ...days, start: '2026-09-30' })).toBe('The day before')
  })

  it('puts both periods and the comparison floor in the footer', () => {
    expect(windowFooter(days, 'Europe/Sofia', 10)).toBe(
      '1–30 Sep against 2–31 Aug, Sofia time · Averages compare only when both periods have at least 10 private ratings.',
    )
  })

  it('has no comparison sentence when the comparison is off or All Time has none', () => {
    expect(windowFooter(null, 'Europe/Sofia', 10)).toBe('All time, Sofia time')
  })

  it('leaves the comparison out of the footer when it is off', () => {
    expect(
      windowFooter({ ...days, compareStart: null, compareEnd: null }, 'Europe/Sofia', 10),
    ).toBe('1–30 Sep, Sofia time')
  })
})

describe('zoneTimeLabel', () => {
  it('names the place the way the guest page does, not the machine id', () => {
    expect(zoneTimeLabel('Europe/Sofia')).toBe('Sofia time')
    expect(zoneTimeLabel('America/New_York')).toBe('New York time')
    expect(zoneTimeLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires time')
  })

  it('writes UTC and a fixed offset without a place name', () => {
    expect(zoneTimeLabel('UTC')).toBe('UTC time')
    expect(zoneTimeLabel('Etc/UTC')).toBe('UTC time')
    // POSIX sign: Etc/GMT-3 is three hours ahead of UTC.
    expect(zoneTimeLabel('Etc/GMT-3')).toBe('UTC+3 time')
  })
})

describe('PORTAL_RESULTS_RANGES', () => {
  it('offers the presets the server reads, All time last', () => {
    expect(PORTAL_RESULTS_RANGES.map((range) => range.value)).toEqual([
      '7d',
      '30d',
      '60d',
      '90d',
      'all',
    ])
  })

  it('words each window the way the dashboard range does: one vocabulary, a longer list', () => {
    expect(PORTAL_RESULTS_RANGES.map((range) => range.label)).toEqual([
      '7 days',
      '30 days',
      '60 days',
      '90 days',
      'All time',
    ])
    for (const range of PORTAL_RESULTS_RANGES) {
      if (range.value in DASHBOARD_RANGE_LABELS) {
        expect(range.label).toBe(
          DASHBOARD_RANGE_LABELS[range.value as keyof typeof DASHBOARD_RANGE_LABELS],
        )
      }
    }
  })
})

describe('storedResultsRange', () => {
  it('keeps a remembered range the picker offers', () => {
    expect(storedResultsRange('7d')).toBe('7d')
    expect(storedResultsRange('all')).toBe('all')
  })

  it('falls back to 30 days for a range the server reads but the picker does not offer', () => {
    // 180d is a valid preset for other views; here it would leave the Select empty.
    expect(storedResultsRange('180d')).toBe('30d')
  })

  it('falls back to 30 days for nothing, or for something stale or hand-edited', () => {
    expect(storedResultsRange(null)).toBe('30d')
    expect(storedResultsRange('yesterday')).toBe('30d')
  })
})

describe('the ranges the Portals overview offers', () => {
  it('are the Results tab ranges without All Time, which is a lifetime figure', () => {
    expect(PORTAL_OVERVIEW_RANGES.map((range) => range.value)).toEqual([
      '7d',
      '30d',
      '60d',
      '90d',
    ])
    expect(PORTAL_OVERVIEW_RANGES.map((range) => range.label)).toEqual(
      PORTAL_RESULTS_RANGES.filter((range) => range.value !== 'all').map(
        (range) => range.label,
      ),
    )
  })

  it('follow the reader from the Results tab, except where All Time was left on', () => {
    expect(storedOverviewRange('7d')).toBe('7d')
    expect(storedOverviewRange('90d')).toBe('90d')
    expect(storedOverviewRange('all')).toBe('30d')
    expect(storedOverviewRange('180d')).toBe('30d')
    expect(storedOverviewRange(null)).toBe('30d')
  })
})
