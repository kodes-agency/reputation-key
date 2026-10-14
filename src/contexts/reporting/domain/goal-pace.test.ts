import { describe, expect, it } from 'vitest'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import {
  GOAL_PACE_QUIET_DAYS,
  GOAL_PACE_THRESHOLD_PERCENT,
  goalPace,
  goalsBehindPaceByProperty,
  type GoalPaceInput,
  type RunningCountMonth,
} from './goal-pace'

const UTC = 'UTC'

/** October 2026 on a UTC calendar: 31 days. */
const OCTOBER = calendarPeriodRange(new Date('2026-10-15T00:00:00.000Z'), UTC, 'monthly')

const input = (overrides: Partial<GoalPaceInput> = {}): GoalPaceInput => ({
  metric: 'qualified_scans',
  value: 0,
  target: 120,
  period: OCTOBER,
  now: new Date('2026-10-17T12:00:00.000Z'),
  timezone: UTC,
  ...overrides,
})

describe('the pace a count goal is held to', () => {
  it('names its two defaults: behind below 90% of the straight line, quiet for 3 days', () => {
    expect(GOAL_PACE_THRESHOLD_PERCENT).toBe(90)
    expect(GOAL_PACE_QUIET_DAYS).toBe(3)
  })

  it('counts whole local days with today included, out of the days in the month', () => {
    const pace = goalPace(input({ now: new Date('2026-10-17T00:00:01.000Z') }))

    expect(pace).toMatchObject({ elapsedDays: 17, totalDays: 31, daysLeft: 14 })
  })

  it('keeps pace at 64 of 120 on the 17th: the line expects 66, 90% of it is 59', () => {
    expect(goalPace(input({ value: 64 })).state).toBe('on_pace')
  })

  it('is behind pace below 90% of the expected count', () => {
    // 120 x 17 / 31 = 65.8; 90% of that is 59.2.
    expect(goalPace(input({ value: 59 })).state).toBe('behind')
    expect(goalPace(input({ value: 60 })).state).toBe('on_pace')
  })

  it('is on pace at exactly 90% of the expected count, never behind it', () => {
    // 30-day month, 10th day: 100 x 10 / 30 = 33.33; 90% is exactly 30.
    const november = calendarPeriodRange(
      new Date('2026-11-10T00:00:00.000Z'),
      UTC,
      'monthly',
    )
    const tenth = input({
      target: 100,
      period: november,
      now: new Date('2026-11-10T09:00:00.000Z'),
    })

    expect(goalPace({ ...tenth, value: 30 }).state).toBe('on_pace')
    expect(goalPace({ ...tenth, value: 29 }).state).toBe('behind')
  })

  it('is ahead of pace when the count is over the whole line', () => {
    expect(goalPace(input({ value: 300 })).state).toBe('on_pace')
  })

  it.each([1, 2, 3])('does not judge day %i of the month, whatever the count', (day) => {
    const early = input({
      value: 0,
      now: new Date(`2026-10-0${day}T23:59:00.000Z`),
    })

    expect(goalPace(early)).toMatchObject({ state: 'too_early', elapsedDays: day })
  })

  it('judges from the fourth day', () => {
    const fourth = input({ value: 0, now: new Date('2026-10-04T00:00:00.000Z') })

    expect(goalPace(fourth)).toMatchObject({ state: 'behind', elapsedDays: 4 })
  })

  it('never calls an average behind pace, only counts it can pace', () => {
    const average = input({
      metric: 'portal_rating_average',
      value: 1.2,
      target: 4.5,
      now: new Date('2026-10-28T12:00:00.000Z'),
    })

    expect(goalPace(average)).toMatchObject({ state: 'not_applicable', daysLeft: 3 })
  })

  it('paces both count measures', () => {
    for (const metric of ['qualified_scans', 'portal_rating_count'] as const) {
      expect(goalPace(input({ metric, value: 10 })).state).toBe('behind')
    }
  })

  it('has no days left on the last day of the month', () => {
    const last = input({ now: new Date('2026-10-31T23:59:00.000Z') })

    expect(goalPace(last)).toMatchObject({ elapsedDays: 31, daysLeft: 0 })
  })

  it('counts days on the Property calendar, not the UTC one', () => {
    // Auckland is UTC+13 in October 2026; its October opens at 11:00 UTC on 30 Sep.
    const auckland = 'Pacific/Auckland'
    const period = calendarPeriodRange(
      new Date('2026-10-15T00:00:00.000Z'),
      auckland,
      'monthly',
    )
    // 04:00 UTC on 5 Oct is 17:00 on 5 Oct in Auckland: day 5.
    const midday = goalPace(
      input({
        timezone: auckland,
        period,
        now: new Date('2026-10-05T04:00:00.000Z'),
      }),
    )
    // 12:00 UTC on 5 Oct is 01:00 on 6 Oct in Auckland: day 6.
    const afterMidnight = goalPace(
      input({
        timezone: auckland,
        period,
        now: new Date('2026-10-05T12:00:00.000Z'),
      }),
    )

    expect(midday.elapsedDays).toBe(5)
    expect(afterMidnight.elapsedDays).toBe(6)
    expect(midday.totalDays).toBe(31)
  })

  it('counts a month with a clock change as the calendar days it has', () => {
    // Sofia ends summer time on 25 Oct 2026: that day has 25 hours, the month 31 days.
    const sofia = 'Europe/Sofia'
    const period = calendarPeriodRange(
      new Date('2026-10-15T00:00:00.000Z'),
      sofia,
      'monthly',
    )
    const pace = goalPace(
      input({ timezone: sofia, period, now: new Date('2026-10-26T10:00:00.000Z') }),
    )

    expect(pace).toMatchObject({ elapsedDays: 26, totalDays: 31, daysLeft: 5 })
  })

  it('keeps a February of 28 days and a leap February of 29', () => {
    const february = (year: number) =>
      calendarPeriodRange(new Date(`${year}-02-10T00:00:00.000Z`), UTC, 'monthly')

    expect(
      goalPace(
        input({ period: february(2027), now: new Date('2027-02-10T10:00:00.000Z') }),
      ).totalDays,
    ).toBe(28)
    expect(
      goalPace(
        input({ period: february(2028), now: new Date('2028-02-10T10:00:00.000Z') }),
      ).totalDays,
    ).toBe(29)
  })

  it('clamps a clock outside the month to its first or last day', () => {
    const before = goalPace(input({ now: new Date('2026-09-20T00:00:00.000Z') }))
    const after = goalPace(input({ now: new Date('2026-11-20T00:00:00.000Z') }))

    expect(before).toMatchObject({ elapsedDays: 0, daysLeft: 31, state: 'too_early' })
    expect(after).toMatchObject({ elapsedDays: 31, daysLeft: 0 })
  })
})

describe('goals behind pace, by Property', () => {
  const NOW = new Date('2026-10-17T12:00:00.000Z')
  const month = (patch: Partial<RunningCountMonth> = {}): RunningCountMonth => ({
    propertyId: 'property-a',
    programId: 'program-1',
    metric: 'qualified_scans',
    period: OCTOBER,
    timezone: UTC,
    target: 120,
    value: 10,
    ...patch,
  })

  it('counts the goals whose live month is below pace, per Property', () => {
    const counts = goalsBehindPaceByProperty(
      [
        month({ programId: 'program-1' }),
        month({ programId: 'program-2', value: 64 }),
        month({ programId: 'program-3', propertyId: 'property-b' }),
      ],
      NOW,
    )

    expect(counts).toEqual(
      new Map([
        ['property-a', 1],
        ['property-b', 1],
      ]),
    )
  })

  it('counts a goal once however many of its subjects are behind', () => {
    const counts = goalsBehindPaceByProperty(
      [month({ value: 10 }), month({ value: 5 }), month({ value: 64 })],
      NOW,
    )

    expect(counts.get('property-a')).toBe(1)
  })

  it('leaves out a Property with nothing behind', () => {
    expect(goalsBehindPaceByProperty([month({ value: 64 })], NOW).size).toBe(0)
    expect(goalsBehindPaceByProperty([], NOW).size).toBe(0)
  })

  it('does not count a month whose figure cannot be read', () => {
    expect(goalsBehindPaceByProperty([month({ value: null })], NOW).size).toBe(0)
  })

  it('does not count a month in its first days', () => {
    const early = new Date('2026-10-03T12:00:00.000Z')

    expect(goalsBehindPaceByProperty([month({ value: 0 })], early).size).toBe(0)
  })

  it('judges each month on its own Property calendar', () => {
    // 20:00 UTC on 3 Oct is 23:00 on the 3rd in Sofia (still unjudged) but
    // 09:00 on the 4th in Auckland (the fourth day: judged).
    const edge = new Date('2026-10-03T20:00:00.000Z')
    const local = (timezone: string, propertyId: string) =>
      month({
        propertyId,
        timezone,
        period: calendarPeriodRange(edge, timezone, 'monthly'),
        value: 0,
      })

    const counts = goalsBehindPaceByProperty(
      [local('Europe/Sofia', 'sofia'), local('Pacific/Auckland', 'auckland')],
      edge,
    )

    expect(counts).toEqual(new Map([['auckland', 1]]))
  })
})
