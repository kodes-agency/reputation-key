// Dashboard utils — time-range + trend helpers.
// Tests lock the deterministic behavior of timeRangeToDates for an injected
// `now`, so dashboards are fast-forward testable (ADR 0017).

import { describe, it, expect } from 'vitest'
import { timeRangeToDates, computeTrend, slaCutoff, MS_PER_DAY } from './utils'

describe('timeRangeToDates', () => {
  const now = new Date('2026-06-19T12:00:00Z')

  it('returns a 30-day window ending at the injected now by default', () => {
    const { startDate, endDate } = timeRangeToDates('30d', now)
    expect(endDate).toEqual(now)
    expect(startDate).toEqual(new Date(now.getTime() - 30 * MS_PER_DAY))
  })

  it('returns a 7-day window for 7d', () => {
    const { startDate, endDate } = timeRangeToDates('7d', now)
    expect(endDate).toEqual(now)
    expect(startDate).toEqual(new Date(now.getTime() - 7 * MS_PER_DAY))
  })

  it('returns a 60-day window for 60d', () => {
    const { startDate } = timeRangeToDates('60d', now)
    expect(startDate).toEqual(new Date(now.getTime() - 60 * MS_PER_DAY))
  })

  it('returns a 90-day window for 90d', () => {
    const { startDate } = timeRangeToDates('90d', now)
    expect(startDate).toEqual(new Date(now.getTime() - 90 * MS_PER_DAY))
  })

  it('returns epoch start for "all" (no lower bound)', () => {
    const { startDate, endDate } = timeRangeToDates('all', now)
    expect(startDate).toEqual(new Date(0))
    expect(endDate).toEqual(now)
  })

  it('produces identical output for the same injected now (deterministic)', () => {
    const a = timeRangeToDates('30d', now)
    const b = timeRangeToDates('30d', now)
    expect(a).toEqual(b)
  })
})

describe('computeTrend', () => {
  it('computes percentage change rounded', () => {
    expect(computeTrend(150, 100)).toBe(50)
    expect(computeTrend(50, 100)).toBe(-50)
  })

  it('returns null when prior is 0', () => {
    expect(computeTrend(10, 0)).toBeNull()
  })

  it('returns null when result is not finite', () => {
    expect(computeTrend(Infinity, 1)).toBeNull()
  })
})

describe('slaCutoff', () => {
  it('returns now minus slaHours in milliseconds', () => {
    const now = new Date('2026-06-19T12:00:00Z')
    expect(slaCutoff(now, 48)).toEqual(new Date('2026-06-17T12:00:00Z'))
  })

  it('reviews older than the cutoff are past SLA', () => {
    const now = new Date('2026-06-19T12:00:00Z')
    const cutoff = slaCutoff(now, 24)
    expect(new Date('2026-06-18T00:00:00Z') < cutoff).toBe(true)
  })

  it('reviews newer than the cutoff are within SLA', () => {
    const now = new Date('2026-06-19T12:00:00Z')
    const cutoff = slaCutoff(now, 24)
    expect(new Date('2026-06-19T10:00:00Z') < cutoff).toBe(false)
  })
})
