import { describe, expect, it } from 'vitest'
import type { RetentionRuleAge } from './execute-retention-rule'
import { retentionRuleCutoff, subtractUtcMonths } from './retention-cutoff'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TWENTY_FOUR_MONTHS = { olderThanMonths: 24 } as const

/**
 * `months` calendar months after `from`, the way a calendar and PostgreSQL
 * count them: the same day and time, or the last day of a shorter month.
 * Written out here so the cutoff is checked against an independent sum.
 */
function calendarMonthsAfter(from: Date, months: number): Date {
  const firstOfTarget = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1)
  const target = new Date(firstOfTarget)
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  )
}

/** One row timestamp per hour across two years that include 29 February 2028. */
function hourlyRowTimestamps(): ReadonlyArray<Date> {
  const start = Date.parse('2027-01-01T00:00:00.000Z')
  const end = Date.parse('2029-01-01T00:00:00.000Z')
  const rows: Date[] = []
  for (let instant = start; instant < end; instant += HOUR_MS) {
    rows.push(new Date(instant))
  }
  return rows
}

describe('retention rule cutoff', () => {
  it('subtracts a fixed age in milliseconds', () => {
    const now = new Date('2026-10-12T03:00:00.000Z')

    expect(retentionRuleCutoff({ olderThanMs: 30 * DAY_MS }, now)).toEqual(
      new Date('2026-09-12T03:00:00.000Z'),
    )
  })

  it('is the run instant itself when the column already holds the deadline', () => {
    const now = new Date('2026-10-12T03:00:00.000Z')

    expect(retentionRuleCutoff({ olderThanMs: 0 }, now)).toEqual(now)
  })

  it('subtracts UTC calendar months, not a number of days', () => {
    // These 24 months span 29 February 2028: 731 days, not 730.
    const now = new Date('2028-09-05T03:00:00.000Z')

    expect(retentionRuleCutoff(TWENTY_FOUR_MONTHS, now)).toEqual(
      new Date('2026-09-05T03:00:00.000Z'),
    )
  })

  it('leaves a rule stated in months no olderThanMs to subtract by hand', () => {
    // Subtracting olderThanMs is how every caller used to derive a cutoff. A
    // rule stated in months has no milliseconds to subtract: were the field 0
    // the cutoff would be "now" and the rule would reach every row. So the
    // type gives such a rule no olderThanMs at all, and the sum does not compile.
    const now = new Date('2028-09-05T03:00:00.000Z')
    const visitFacts: RetentionRuleAge = { olderThanMonths: 24 }

    // @ts-expect-error -- a rule stated in months has no olderThanMs
    const cutoffByHand = new Date(now.getTime() - visitFacts.olderThanMs)

    expect(Number.isNaN(cutoffByHand.getTime())).toBe(true)
  })

  it('clamps to the last day of a shorter month instead of rolling into the next', () => {
    expect(subtractUtcMonths(new Date('2028-02-29T12:00:00.000Z'), 24)).toEqual(
      new Date('2026-02-28T12:00:00.000Z'),
    )
    expect(subtractUtcMonths(new Date('2026-03-31T00:00:00.000Z'), 1)).toEqual(
      new Date('2026-02-28T00:00:00.000Z'),
    )
  })

  it('never reaches a row before its 24 calendar months have passed', () => {
    const reachedEarly = hourlyRowTimestamps().filter((row) => {
      const lastInstantInside = new Date(calendarMonthsAfter(row, 24).getTime() - 1)
      return retentionRuleCutoff(TWENTY_FOUR_MONTHS, lastInstantInside) > row
    })

    expect(reachedEarly).toEqual([])
  })

  it('reaches every row within a day of its 24 calendar months', () => {
    // A row stamped on 29 February is the slow case: its months end on
    // 28 February two years on, and the cutoff passes it at the next midnight.
    const stillKeptADayLater = hourlyRowTimestamps().filter((row) => {
      const aDayAfter = new Date(calendarMonthsAfter(row, 24).getTime() + DAY_MS)
      return retentionRuleCutoff(TWENTY_FOUR_MONTHS, aDayAfter) <= row
    })

    expect(stillKeptADayLater).toEqual([])
  })
})
