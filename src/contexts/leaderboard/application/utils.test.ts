// Leaderboard context — date range utility tests

import { describe, it, expect } from 'vitest'
import { periodToRange, LEADERBOARD_PERIODS } from './utils'

const REF = new Date('2026-06-15T14:30:00.000Z')

describe('periodToRange', () => {
  it('returns all LEADERBOARD_PERIODS', () => {
    expect(LEADERBOARD_PERIODS).toHaveLength(8)
    expect(LEADERBOARD_PERIODS).toContain('today')
    expect(LEADERBOARD_PERIODS).toContain('all_time')
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

  it('last_7_days start is 6 days before end date', () => {
    const { start, end } = periodToRange('last_7_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 6)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('last_30_days start is 29 days before end date', () => {
    const { start, end } = periodToRange('last_30_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 29)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('last_90_days start is 89 days before end date', () => {
    const { start, end } = periodToRange('last_90_days', REF)
    const expectedStart = new Date(REF)
    expectedStart.setDate(expectedStart.getDate() - 89)
    expectedStart.setHours(0, 0, 0, 0)
    expect(start).toEqual(expectedStart)
    expect(end).toEqual(REF)
  })

  it('all_time returns undefined boundaries', () => {
    const { start, end } = periodToRange('all_time', REF)
    expect(start).toBeUndefined()
    expect(end).toBeUndefined()
  })
})
