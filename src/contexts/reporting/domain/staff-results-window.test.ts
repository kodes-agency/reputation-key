import { describe, expect, it } from 'vitest'
import { staffResultsSeries, staffResultsWindow } from './staff-results-window'

describe('staff periods in the Property calendar', () => {
  it('cuts ratings at local midnight, including a DST day', () => {
    const result = staffResultsWindow(
      new Date('2026-11-01T19:00:00Z'),
      'America/New_York',
      'US',
      'week',
    )
    expect(result.ratingsCutoff.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(result.startAt.toISOString()).toBe('2026-11-01T04:00:00.000Z')
  })
  it('starts a US week on Sunday and other weeks on Monday', () => {
    const now = new Date('2026-11-04T16:00:00Z')
    expect(
      staffResultsWindow(now, 'Europe/Sofia', 'BG', 'week').startAt.toISOString(),
    ).toBe('2026-11-01T22:00:00.000Z')
    expect(
      staffResultsWindow(now, 'America/New_York', 'US', 'week').startAt.toISOString(),
    ).toBe('2026-11-01T04:00:00.000Z')
  })
})

it('uses the previous whole local month across DST and a year boundary', () => {
  const october = staffResultsWindow(
    new Date('2026-11-01T02:00:00Z'),
    'Europe/Sofia',
    'BG',
    'last_month',
  )
  expect(october.startAt.toISOString()).toBe('2026-09-30T21:00:00.000Z')
  expect(october.endAt.toISOString()).toBe('2026-10-31T22:00:00.000Z')
  expect(october.ratingsCutoff).toEqual(october.endAt)
  const december = staffResultsWindow(
    new Date('2027-01-02T12:00:00Z'),
    'America/New_York',
    'US',
    'last_month',
  )
  expect(december.startAt.toISOString()).toBe('2026-12-01T05:00:00.000Z')
  expect(december.endAt.toISOString()).toBe('2027-01-01T05:00:00.000Z')
})

it('keeps the event window complete but admits late processing only through last midnight', () => {
  const window = staffResultsWindow(
    new Date('2026-11-04T12:00:00Z'),
    'Europe/Sofia',
    'BG',
    'last_month',
  )
  expect(window.endAt.toISOString()).toBe('2026-10-31T22:00:00.000Z')
  expect(window.ratingsCutoff.toISOString()).toBe('2026-11-03T22:00:00.000Z')
})

describe('the bars under a person’s scans', () => {
  const scans = new Map([
    ['2026-11-01', 2],
    ['2026-11-02', 3],
    ['2026-11-08', 4],
    ['2026-11-09', 5],
  ])
  const at = new Date('2026-11-11T10:00:00Z')
  it('has none for today', () => {
    expect(staffResultsSeries(at, 'Europe/Sofia', 'BG', 'today', scans)).toBeNull()
  })
  it('splits a month at Monday, with the running week open', () => {
    const series = staffResultsSeries(at, 'Europe/Sofia', 'BG', 'month', scans)
    expect(series).toEqual({
      unit: 'week',
      columns: [
        { start: '2026-11-01', scans: 2, open: false },
        { start: '2026-11-02', scans: 7, open: false },
        { start: '2026-11-09', scans: 5, open: true },
      ],
    })
  })
  it('splits a US month at Sunday, across the clock change', () => {
    const series = staffResultsSeries(at, 'America/New_York', 'US', 'month', scans)
    expect(series?.columns.map((column) => [column.start, column.scans])).toEqual([
      ['2026-11-01', 5],
      ['2026-11-08', 9],
    ])
  })
  it('shows this week day by day, with today open', () => {
    const series = staffResultsSeries(at, 'Europe/Sofia', 'BG', 'week', scans)
    expect(series?.unit).toBe('day')
    expect(series?.columns.map((column) => column.start)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ])
    expect(series?.columns.at(-1)?.open).toBe(true)
    expect(series?.columns[0]?.open).toBe(false)
  })
  it('closes every week of last month, up to its last day', () => {
    const october = new Map([
      ['2026-10-01', 1],
      ['2026-10-31', 6],
    ])
    const series = staffResultsSeries(at, 'Europe/Sofia', 'BG', 'last_month', october)
    expect(series?.columns[0]).toEqual({ start: '2026-10-01', scans: 1, open: false })
    expect(series?.columns.at(-1)).toEqual({ start: '2026-10-26', scans: 6, open: false })
    expect(series?.columns.every((column) => !column.open)).toBe(true)
  })
})
