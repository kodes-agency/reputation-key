// Shared period-range tests — merged from the badge/leaderboard copies (BQC-5.9 E3).

import { describe, it, expect } from 'vitest'
import {
  calendarPeriodRange,
  dayKeyInTimezone,
  PERIOD_PRESETS,
  periodToRange,
} from './period-range'

const REF = new Date('2026-06-15T14:30:00.000Z')

describe('periodToRange', () => {
  it('returns all PERIOD_PRESETS', () => {
    expect(PERIOD_PRESETS).toHaveLength(8)
    expect(PERIOD_PRESETS).toContain('today')
    expect(PERIOD_PRESETS).toContain('all_time')
  })

  it('today starts at midnight', () => {
    const { start, end } = periodToRange('today', REF)
    expect(start!.getHours()).toBe(0)
    expect(start!.getMinutes()).toBe(0)
    expect(end).toEqual(REF)
  })

  it('this_week starts on Monday at midnight', () => {
    const { start } = periodToRange('this_week', REF)
    expect(start!.getDay()).toBe(1)
    expect(start!.getHours()).toBe(0)
  })

  it('this_week starts on the previous Monday when run on a Sunday', () => {
    // 2026-06-21 is a Sunday (getDay() === 0) — the week starts 6 days back.
    const SUNDAY = new Date('2026-06-21T14:30:00.000Z')
    const { start } = periodToRange('this_week', SUNDAY)
    expect(start!.getDay()).toBe(1)
    expect(start!.getDate()).toBe(15)
    expect(start!.getHours()).toBe(0)
  })

  it('this_month starts on day 1', () => {
    const { start } = periodToRange('this_month', REF)
    expect(start!.getDate()).toBe(1)
    expect(start!.getHours()).toBe(0)
  })

  it('this_quarter starts at quarter boundary', () => {
    const { start } = periodToRange('this_quarter', REF)
    expect(start!.getMonth()).toBe(3)
    expect(start!.getDate()).toBe(1)
  })

  it('last_7_days start is 6 days before end', () => {
    const { start, end } = periodToRange('last_7_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 6)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('last_30_days start is 29 days before end', () => {
    const { start, end } = periodToRange('last_30_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 29)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('last_90_days start is 89 days before end', () => {
    const { start, end } = periodToRange('last_90_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 89)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('returns undefined boundaries for all_time', () => {
    const { start, end } = periodToRange('all_time', REF)
    expect(start).toBeUndefined()
    expect(end).toBeUndefined()
  })

  it('returns undefined boundaries for undefined period', () => {
    const { start, end } = periodToRange(undefined, REF)
    expect(start).toBeUndefined()
    expect(end).toBeUndefined()
  })
})

describe('dayKeyInTimezone', () => {
  it('formats date as yyyy_MM_dd', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T14:30:00Z'), 'UTC')
    expect(key).toBe('2026_06_15')
  })

  it('shifts day forward in positive timezone', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T23:00:00Z'), 'Asia/Tokyo')
    expect(key).toBe('2026_06_16')
  })

  it('shifts day backward in negative timezone', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T02:00:00Z'), 'America/Los_Angeles')
    expect(key).toBe('2026_06_14')
  })
})

describe('calendarPeriodRange', () => {
  it('uses property-local month boundaries across a DST transition', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-03-15T12:00:00.000Z'),
        'America/New_York',
        'monthly',
      ),
    ).toEqual({
      start: new Date('2026-03-01T05:00:00.000Z'),
      end: new Date('2026-04-01T04:00:00.000Z'),
    })
  })

  it('uses Monday-start property-local weekly boundaries', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-06-21T14:00:00.000Z'),
        'America/Los_Angeles',
        'weekly',
      ),
    ).toEqual({
      start: new Date('2026-06-15T07:00:00.000Z'),
      end: new Date('2026-06-22T07:00:00.000Z'),
    })
  })
})
