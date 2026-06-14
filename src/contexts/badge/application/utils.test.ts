// Badge context — date utility tests

import { describe, it, expect } from 'vitest'
import { periodToRange, dayKeyInTimezone } from './utils'

const REF = new Date('2026-06-15T14:30:00.000Z')

describe('periodToRange (badge)', () => {
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

  it('this_month starts on day 1', () => {
    const { start } = periodToRange('this_month', REF)
    expect(start!.getDate()).toBe(1)
    expect(start!.getHours()).toBe(0)
  })

  it('this_quarter starts at Q2 boundary (April 1)', () => {
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
