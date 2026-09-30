// Dashboard utils — time-range + trend helpers.
// Tests lock the deterministic behavior of timeRangeToDates for an injected
// `now`, so dashboards are fast-forward testable (ADR 0017).

import { describe, it, expect } from 'vitest'
import {
  localDaysWindow,
  timeRangeToDates,
  computeTrend,
  priorPeriodDates,
  ratingComparison,
  MS_PER_DAY,
} from './utils'

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

  it('subtracts Property-local calendar days across DST', () => {
    const dstNow = new Date('2026-03-20T16:00:00.000Z') // noon in New York
    const { startDate, endDate } = timeRangeToDates('30d', dstNow, 'America/New_York')

    expect(startDate).toEqual(new Date('2026-02-18T17:00:00.000Z'))
    expect(endDate).toEqual(dstNow)
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

describe('ratingComparison', () => {
  it('returns an absolute one-decimal star delta with sufficient samples', () => {
    expect(ratingComparison(4.4, 12, 4, 10)).toBe(0.4)
  })

  it('withholds a comparison when either period has fewer than ten ratings', () => {
    expect(ratingComparison(4.4, 9, 4, 10)).toBeNull()
    expect(ratingComparison(4.4, 10, 4, 9)).toBeNull()
  })

  it('withholds a comparison when either average is unavailable', () => {
    expect(ratingComparison(null, 10, 4, 10)).toBeNull()
    expect(ratingComparison(4.4, 10, null, 10)).toBeNull()
  })
})

describe('priorPeriodDates', () => {
  const endDate = new Date('2026-06-19T12:00:00Z')

  it('returns null for "all" — an unbounded window has no prior window', () => {
    expect(priorPeriodDates('all', new Date(0), endDate)).toBeNull()
  })

  it('never lets "all" fabricate a 0% trend by comparing the period to itself', () => {
    const prior = priorPeriodDates('all', new Date(0), endDate)
    // The old contract returned the CURRENT window here, and computeTrend(x, x)
    // is 0 — not null — because the `prior === 0` guard never binds.
    expect(prior).toBeNull()
    expect(computeTrend(100, 100)).toBe(0)
  })

  it.each(['7d', '30d', '60d', '90d'] as const)(
    'gives %s a contiguous, non-overlapping prior window of equal duration',
    (preset) => {
      const days =
        preset === '7d' ? 7 : preset === '60d' ? 60 : preset === '90d' ? 90 : 30
      const startDate = new Date(endDate.getTime() - days * MS_PER_DAY)
      const prior = priorPeriodDates(preset, startDate, endDate)

      expect(prior).not.toBeNull()
      // Equal duration immediately before. Both readers use [start, end), so
      // the shared boundary is contiguous without being double-counted.
      expect(prior!.priorStartDate).toEqual(
        new Date(startDate.getTime() - days * MS_PER_DAY),
      )
      expect(prior!.priorEndDate).toEqual(startDate)
    },
  )

  it('keeps the preceding period on the same Property-local wall clock', () => {
    const endDate = new Date('2026-03-20T16:00:00.000Z')
    const startDate = new Date('2026-02-18T17:00:00.000Z')

    expect(priorPeriodDates('30d', startDate, endDate, 'America/New_York')).toEqual({
      priorStartDate: new Date('2026-01-19T17:00:00.000Z'),
      priorEndDate: startDate,
    })
  })
})

describe('localDaysWindow', () => {
  // 14:23 on 30 Sep in Sofia (UTC+3 in summer).
  const now = new Date('2026-09-30T11:23:00.000Z')
  const SOFIA = 'Europe/Sofia'

  it('opens a 30-day window at Property-local midnight, today included', () => {
    const { startDate, endDate } = localDaysWindow('30d', now, SOFIA)

    // 1 Sep 00:00 in Sofia, so the window reads "1-30 Sep".
    expect(startDate).toEqual(new Date('2026-08-31T21:00:00.000Z'))
    expect(endDate).toEqual(now)
  })

  it('gives 7d seven local calendar days, not seven times 24 hours', () => {
    const { startDate } = localDaysWindow('7d', now, SOFIA)

    expect(startDate).toEqual(new Date('2026-09-23T21:00:00.000Z'))
  })

  it('lines the prior window up with whole local days, 2-31 Aug', () => {
    const { startDate, endDate } = localDaysWindow('30d', now, SOFIA)

    expect(priorPeriodDates('30d', startDate, endDate, SOFIA)).toEqual({
      priorStartDate: new Date('2026-08-01T21:00:00.000Z'),
      priorEndDate: startDate,
    })
  })

  it('counts local days across a DST change, not elapsed hours', () => {
    // New York springs forward on 8 Mar 2026; 14 Mar 12:00 local is 16:00Z.
    const dstNow = new Date('2026-03-14T16:00:00.000Z')
    const { startDate } = localDaysWindow('7d', dstNow, 'America/New_York')

    // 8 Mar 00:00 EST (before the change), which is 05:00Z.
    expect(startDate).toEqual(new Date('2026-03-08T05:00:00.000Z'))
  })

  it('takes the local date from the Property zone, not from UTC', () => {
    // 22:30Z on 30 Sep is already 1 Oct in Auckland (UTC+13 since 27 Sep).
    const lateNow = new Date('2026-09-30T22:30:00.000Z')
    const { startDate } = localDaysWindow('7d', lateNow, 'Pacific/Auckland')

    // 25 Sep 00:00 NZST (DST only begins on the 27th) is 24 Sep 12:00Z.
    expect(startDate).toEqual(new Date('2026-09-24T12:00:00.000Z'))
  })

  it('leaves All Time unbounded: from the epoch to now', () => {
    expect(localDaysWindow('all', now, SOFIA)).toEqual({
      startDate: new Date(0),
      endDate: now,
    })
  })
})
