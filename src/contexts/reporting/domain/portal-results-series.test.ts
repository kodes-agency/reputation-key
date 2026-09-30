// Portal results series — the weekly view behind the Results tab's chart.
import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  buildPortalResultsSeries,
  localDateOf,
  localDayRange,
  placeVersionMarker,
  windowLocalDays,
  type SeriesReadingRow,
} from './portal-results-series'

const SOFIA = 'Europe/Sofia'
// "Last 30 days" on 30 Sep: 1-30 Sep, opening at Sofia midnight.
const START = new Date('2026-08-31T21:00:00.000Z')
const END = new Date('2026-09-30T11:23:00.000Z')
const PRIOR_START = new Date('2026-08-01T21:00:00.000Z')

const scans = (bucket: number, total: number): SeriesReadingRow => ({
  bucket,
  metricKey: 'portal.qualified_scan',
  total,
  count: total,
})
const ratings = (bucket: number, total: number, count: number): SeriesReadingRow => ({
  bucket,
  metricKey: 'portal.rating',
  total,
  count,
})

const READY = { scans: true, ratings: true, priorScans: true } as const
const FLOOR = 5

function build(
  current: readonly SeriesReadingRow[],
  prior: readonly SeriesReadingRow[] | null,
  ready: { scans: boolean; ratings: boolean; priorScans: boolean } = READY,
) {
  return buildPortalResultsSeries({
    timezone: SOFIA,
    current: { startDate: START, endDate: END, rows: current },
    prior: prior && { startDate: PRIOR_START, endDate: START, rows: prior },
    ready,
    averageMinSample: FLOOR,
  })
}

describe('local dates', () => {
  it('reads the date in the Property zone, not in UTC', () => {
    expect(localDateOf(START, SOFIA)).toBe('2026-09-01')
    expect(localDateOf(START, 'UTC')).toBe('2026-08-31')
  })

  it('adds days across month ends', () => {
    expect(addLocalDays('2026-08-30', 3)).toBe('2026-09-02')
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('counts the local days of a window whose end is exclusive', () => {
    expect(windowLocalDays(START, END, SOFIA)).toBe(30)
    // The prior window ends at the next window's midnight: 2-31 Aug is 30 days.
    expect(windowLocalDays(PRIOR_START, START, SOFIA)).toBe(30)
  })
})

describe('localDayRange', () => {
  it('names the first and last local day of a half-open window', () => {
    expect(localDayRange(START, END, SOFIA)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    })
  })

  it('does not count the day that opens at the exclusive end', () => {
    // The prior window ends at the next window's midnight: 2-31 Aug.
    expect(localDayRange(PRIOR_START, START, SOFIA)).toEqual({
      start: '2026-08-02',
      end: '2026-08-31',
    })
  })
})

describe('buildPortalResultsSeries', () => {
  it('anchors weekly buckets to the window start, the last one partial', () => {
    const { weeks } = build([], null)

    expect(
      weeks.map((week) => [week.startLocalDate, week.endLocalDate, week.days]),
    ).toEqual([
      ['2026-09-01', '2026-09-07', 7],
      ['2026-09-08', '2026-09-14', 7],
      ['2026-09-15', '2026-09-21', 7],
      ['2026-09-22', '2026-09-28', 7],
      ['2026-09-29', '2026-09-30', 2],
    ])
  })

  it('carries qualified scans per bucket and leaves an empty bucket at a true zero', () => {
    const { weeks } = build([scans(0, 88), scans(1, 92)], null)

    expect(weeks.map((week) => week.scans)).toEqual([88, 92, 0, 0, 0])
  })

  it('computes each average as sum over count, never a mean of daily means', () => {
    // Nine ratings worth 39 stars: 4.3. A mean of two daily means would differ.
    const { weeks } = build([ratings(1, 39, 9)], null)

    expect(weeks[1]).toMatchObject({ ratings: 9, average: 4.3 })
  })

  it('holds an average back below the floor and still says how many ratings there are', () => {
    const { weeks } = build([ratings(4, 17, 4)], null)

    expect(weeks[4]).toMatchObject({ ratings: 4, average: null })
  })

  it('shows an average at exactly the floor', () => {
    const { weeks } = build([ratings(0, 25, 5)], null)

    expect(weeks[0]?.average).toBe(5)
  })

  it('puts the prior window on the same bucket index', () => {
    const { weeks } = build([scans(0, 10)], [scans(0, 7), scans(3, 4)])

    expect(weeks.map((week) => week.priorScans)).toEqual([7, 0, 0, 4, 0])
  })

  it('shows no prior figure when the comparison is off', () => {
    const { weeks } = build([scans(0, 10)], null)

    expect(weeks.every((week) => week.priorScans === null)).toBe(true)
  })

  it('never turns scans that are not ready into zeros', () => {
    const { weeks } = build([scans(0, 10)], [scans(0, 7)], {
      ...READY,
      scans: false,
    })

    expect(weeks.every((week) => week.scans === null)).toBe(true)
  })

  it('leaves prior scans out when the prior window predates the measure', () => {
    const { weeks } = build([scans(0, 10)], [scans(0, 7)], {
      ...READY,
      priorScans: false,
    })

    expect(weeks.map((week) => week.scans)).toEqual([10, 0, 0, 0, 0])
    expect(weeks.every((week) => week.priorScans === null)).toBe(true)
  })

  it('withholds every average while ratings are not ready, but keeps the scans', () => {
    const { weeks } = build([ratings(0, 50, 10), scans(0, 3)], null, {
      ...READY,
      ratings: false,
    })

    expect(weeks[0]).toMatchObject({ scans: 3, average: null })
  })

  it('says why an average is absent: below the floor, or ratings not ready', () => {
    const below = build([ratings(4, 17, 4)], null).weeks
    const shown = build([ratings(0, 25, 5)], null).weeks
    const unready = build([ratings(0, 200, 40)], null, { ...READY, ratings: false }).weeks

    expect(below[4]?.averageWithheld).toBe('below_floor')
    expect(shown[0]?.averageWithheld).toBeNull()
    expect(unready[0]?.averageWithheld).toBe('not_ready')
  })

  it('does not count ratings while ratings are not ready, as it does not count scans', () => {
    const { weeks } = build([ratings(0, 200, 40)], null, { ...READY, ratings: false })

    expect(weeks.every((week) => week.ratings === null)).toBe(true)
  })

  it('ignores a reading that lands outside the window rather than invent a bucket', () => {
    const { weeks } = build([scans(9, 500), scans(-1, 500)], null)

    expect(weeks.map((week) => week.scans)).toEqual([0, 0, 0, 0, 0])
  })

  it('gives a 7-day window exactly one bucket', () => {
    const weekStart = new Date('2026-09-23T21:00:00.000Z')
    const { weeks } = buildPortalResultsSeries({
      timezone: SOFIA,
      current: { startDate: weekStart, endDate: END, rows: [scans(0, 5)] },
      prior: null,
      ready: READY,
      averageMinSample: FLOOR,
    })

    expect(weeks).toHaveLength(1)
    expect(weeks[0]).toMatchObject({ startLocalDate: '2026-09-24', days: 7, scans: 5 })
  })
})

describe('placeVersionMarker', () => {
  it('places a publication on its local day within its bucket', () => {
    // 22 Sep, 09:00 in Sofia: the first day of the fourth bucket.
    const marker = placeVersionMarker(
      { version: 5, kind: 'publish', activatedAt: new Date('2026-09-22T06:00:00.000Z') },
      START,
      END,
      SOFIA,
    )

    expect(marker).toMatchObject({
      version: 5,
      kind: 'publish',
      localDate: '2026-09-22',
      week: 3,
      dayInWeek: 0,
    })
  })

  it('uses the local day, not the UTC day, near midnight', () => {
    // 23:30Z on 14 Sep is 02:30 on the 15th in Sofia: bucket 2, day 0.
    const marker = placeVersionMarker(
      { version: 3, kind: 'rollback', activatedAt: new Date('2026-09-14T23:30:00.000Z') },
      START,
      END,
      SOFIA,
    )

    expect(marker).toMatchObject({ localDate: '2026-09-15', week: 2, dayInWeek: 0 })
  })

  it('drops a publication outside the window', () => {
    const before = placeVersionMarker(
      { version: 1, kind: 'publish', activatedAt: new Date('2026-08-20T10:00:00.000Z') },
      START,
      END,
      SOFIA,
    )

    expect(before).toBeNull()
  })
})
