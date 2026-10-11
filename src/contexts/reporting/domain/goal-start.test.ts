import { describe, expect, it } from 'vitest'
import { firstFullMonthlyPeriodAtOrAfter, isCompleteMonthlyPeriod } from './goal-program'
import {
  defaultGoalStartMonth,
  goalStartOptions,
  GOAL_CURRENT_MONTH_CUTOFF_DAY,
  resolveGoalStart,
} from './goal-start'

describe('the month a new goal starts in', () => {
  const SOFIA = 'Europe/Sofia'
  // Sofia is UTC+3 in October 2026 and UTC+2 from the 25th.
  const OCTOBER = {
    start: new Date('2026-09-30T21:00:00.000Z'),
    end: new Date('2026-10-31T22:00:00.000Z'),
  }
  const NOVEMBER = {
    start: new Date('2026-10-31T22:00:00.000Z'),
    end: new Date('2026-11-30T22:00:00.000Z'),
  }

  it('offers the current local month and the next one, each a complete month', () => {
    const options = goalStartOptions(new Date('2026-10-11T09:00:00.000Z'), SOFIA)

    expect(options).toEqual({
      current: { monthKey: '2026-10', period: OCTOBER },
      next: { monthKey: '2026-11', period: NOVEMBER },
    })
    expect(isCompleteMonthlyPeriod(options.current.period, SOFIA)).toBe(true)
    expect(isCompleteMonthlyPeriod(options.next.period, SOFIA)).toBe(true)
  })

  it('rolls the next month over the year end', () => {
    const options = goalStartOptions(new Date('2026-12-15T12:00:00.000Z'), 'UTC')

    expect(options.current.monthKey).toBe('2026-12')
    expect(options.next).toEqual({
      monthKey: '2027-01',
      period: {
        start: new Date('2027-01-01T00:00:00.000Z'),
        end: new Date('2027-02-01T00:00:00.000Z'),
      },
    })
  })

  it('defaults to this month on local day 20 and to next month on day 21', () => {
    expect(GOAL_CURRENT_MONTH_CUTOFF_DAY).toBe(20)
    expect(defaultGoalStartMonth(new Date('2026-10-01T00:00:00.000Z'), 'UTC')).toBe(
      '2026-10',
    )
    expect(defaultGoalStartMonth(new Date('2026-10-20T23:59:59.000Z'), 'UTC')).toBe(
      '2026-10',
    )
    expect(defaultGoalStartMonth(new Date('2026-10-21T00:00:00.000Z'), 'UTC')).toBe(
      '2026-11',
    )
  })

  it('uses the Property time zone, not UTC, for the day', () => {
    // 22:30 UTC on the 20th is already 01:30 on the 21st in Sofia.
    const lateOnTheTwentieth = new Date('2026-10-20T22:30:00.000Z')
    expect(defaultGoalStartMonth(lateOnTheTwentieth, 'UTC')).toBe('2026-10')
    expect(defaultGoalStartMonth(lateOnTheTwentieth, SOFIA)).toBe('2026-11')

    // 02:00 UTC on the 21st is still 22:00 on the 20th in New York.
    const earlyOnTheTwentyFirst = new Date('2026-10-21T02:00:00.000Z')
    expect(defaultGoalStartMonth(earlyOnTheTwentyFirst, 'UTC')).toBe('2026-11')
    expect(defaultGoalStartMonth(earlyOnTheTwentyFirst, 'America/New_York')).toBe(
      '2026-10',
    )
  })

  it('resolves the current or the next local month from its key', () => {
    const now = new Date('2026-10-25T09:00:00.000Z')

    expect(resolveGoalStart(now, SOFIA, '2026-10')).toEqual({
      ok: true,
      period: OCTOBER,
    })
    expect(resolveGoalStart(now, SOFIA, '2026-11')).toEqual({
      ok: true,
      period: NOVEMBER,
    })
  })

  it('a month key that is neither the current nor the next local month is refused', () => {
    const now = new Date('2026-10-25T09:00:00.000Z')

    for (const stale of ['2026-09', '2026-12', '2025-10', '2026-10-25', 'next']) {
      expect(resolveGoalStart(now, SOFIA, stale)).toEqual({
        ok: false,
        reason: 'start_month_changed',
      })
    }
    // 22:30 UTC on 31 October is already November in Sofia, so the October
    // a form opened that afternoon no longer exists as a choice.
    expect(
      resolveGoalStart(new Date('2026-10-31T22:30:00.000Z'), SOFIA, '2026-10'),
    ).toEqual({ ok: false, reason: 'start_month_changed' })
  })

  it('keeps the next full month when no start month is given', () => {
    const now = new Date('2026-10-11T09:00:00.000Z')

    expect(resolveGoalStart(now, SOFIA)).toEqual({ ok: true, period: NOVEMBER })
    expect(resolveGoalStart(OCTOBER.start, SOFIA)).toEqual({
      ok: true,
      period: firstFullMonthlyPeriodAtOrAfter(OCTOBER.start, SOFIA),
    })
  })

  // 04:30Z on 1 November 2026 is 00:30 CDT in Havana: local November, in the
  // first pass of the repeated midnight hour. November begins at the later
  // occurrence (05:00Z), so a goal for "this month" has not started yet and
  // its Program must wait as scheduled rather than open a month early.
  it('this month on a repeated-midnight first hour stays scheduled', () => {
    const now = new Date('2026-11-01T04:30:00.000Z')
    const start = resolveGoalStart(now, 'America/Havana', '2026-11')

    expect(defaultGoalStartMonth(now, 'America/Havana')).toBe('2026-11')
    expect(start).toEqual({
      ok: true,
      period: {
        start: new Date('2026-11-01T05:00:00.000Z'),
        end: new Date('2026-12-01T05:00:00.000Z'),
      },
    })
    expect(start.ok && start.period.start.getTime() > now.getTime()).toBe(true)
  })
})
