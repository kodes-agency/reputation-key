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

/**
 * One row timestamp per hour across three years. They include both ends of the
 * leap day: a row stamped on 29 February 2028, and the rows of February and
 * March 2026, whose 24 months end around a run on 29 February 2028.
 */
function hourlyRowTimestamps(): ReadonlyArray<Date> {
  const start = Date.parse('2026-01-01T00:00:00.000Z')
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
    //
    // The proof is the `@ts-expect-error` below, which `pnpm typecheck` checks
    // and this run does not: if the field came back, that directive would have
    // no error to expect and the type check would fail. The expectation after
    // it only shows what the sum would have produced.
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

  it('reaches every row once more than a day has passed since its 24 calendar months', () => {
    // Two slow cases, both from the clamp. A row stamped on 29 February: its
    // months end on 28 February two years on, and the cutoff passes it at the
    // next midnight. A row stamped on 28 February two years before a leap day:
    // a run on that 29 February counts back to 28 February at its own time of
    // day, so a full day after the row's months ended the cutoff is the row's
    // own instant, and passes it in the next millisecond.
    const stillKeptAfterADay = hourlyRowTimestamps().filter((row) => {
      const justOverADayAfter = new Date(
        calendarMonthsAfter(row, 24).getTime() + DAY_MS + 1,
      )
      return retentionRuleCutoff(TWENTY_FOUR_MONTHS, justOverADayAfter) <= row
    })

    expect(stillKeptAfterADay).toEqual([])
  })

  it('makes a visit of 28 February wait for the run after 29 February', () => {
    // The daily sweep runs at one time of day. This visit's 24 months ended on
    // 28 February 2028 at 10:00, after that day's run. The run on the leap day
    // counts back to 28 February 2026 at 03:00, before the visit, so it is the
    // run of 1 March that deletes the row: late by a second day, never early.
    const visit = new Date('2026-02-28T10:00:00.000Z')
    const cutoffAt = (run: string) =>
      retentionRuleCutoff(TWENTY_FOUR_MONTHS, new Date(run))

    expect(cutoffAt('2028-02-28T03:00:00.000Z')).toEqual(
      new Date('2026-02-28T03:00:00.000Z'),
    )
    expect(cutoffAt('2028-02-29T03:00:00.000Z')).toEqual(
      new Date('2026-02-28T03:00:00.000Z'),
    )
    expect(cutoffAt('2028-02-29T03:00:00.000Z') > visit).toBe(false)
    expect(cutoffAt('2028-03-01T03:00:00.000Z') > visit).toBe(true)
  })
})
