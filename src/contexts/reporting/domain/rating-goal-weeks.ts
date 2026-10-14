// Property Google rating goal — Monday-to-Sunday weeks (pure).
//
// "This week" and the weekly bars of a goal count reviews in Monday-to-Sunday
// weeks of the Property's time zone (DECISIONS.md defaults). A week is named
// by its Monday (`YYYY-MM-DD`), the same key PostgreSQL's
// `date_trunc('week', ts AT TIME ZONE tz)` produces, and starts at local
// midnight on that Monday, whatever the clocks did that weekend.

import {
  propertyWallClockAt,
  propertyWallClockToInstant,
} from '#/shared/domain/property-calendar'

/** The weekly bars of a goal show at most a year. */
export const MAX_WEEKLY_BARS = 52

export type WeekCount = Readonly<{ weekStart: string; count: number }>

type CivilDate = Readonly<{ year: number; month: number; day: number }>

const civilDateAt = (instant: Date, timezone: string): CivilDate => {
  const local = propertyWallClockAt(instant, timezone)
  return { year: local.year, month: local.month, day: local.day }
}

/** A civil date moved by whole days (calendar arithmetic, no time zone). */
function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  }
}

/** The Monday of a civil date's week. */
function mondayOf(date: CivilDate): CivilDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}

const keyOf = (date: CivilDate): string =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`

const instantOf = (date: CivilDate, timezone: string): Date =>
  propertyWallClockToInstant(
    { ...date, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  )

/** The Property-local Monday of the week an instant falls in. */
export const weekStartKey = (instant: Date, timezone: string): string =>
  keyOf(mondayOf(civilDateAt(instant, timezone)))

/** The instant the Property-local week of `instant` starts: Monday, 00:00. */
export const weekStartInstant = (instant: Date, timezone: string): Date =>
  instantOf(mondayOf(civilDateAt(instant, timezone)), timezone)

/** The first week the bars show: the goal's own week, or a year back at most. */
function firstMonday(since: Date, now: Date, timezone: string): CivilDate {
  const sinceMonday = mondayOf(civilDateAt(since, timezone))
  const earliest = addDays(
    mondayOf(civilDateAt(now, timezone)),
    -7 * (MAX_WEEKLY_BARS - 1),
  )
  return keyOf(sinceMonday) < keyOf(earliest) ? earliest : sinceMonday
}

/** The instant the weekly bars start counting from. */
export const weeklySeriesStart = (since: Date, now: Date, timezone: string): Date =>
  instantOf(firstMonday(since, now, timezone), timezone)

/** One bar per week from the goal's week to this one; a week without reviews is 0. */
export function weeklySeries(
  since: Date,
  now: Date,
  timezone: string,
  counts: readonly WeekCount[],
): WeekCount[] {
  const byWeek = new Map(counts.map((row) => [row.weekStart, row.count]))
  const lastKey = weekStartKey(now, timezone)
  const series: WeekCount[] = []
  for (
    let monday = firstMonday(since, now, timezone);
    keyOf(monday) <= lastKey;
    monday = addDays(monday, 7)
  ) {
    const weekStart = keyOf(monday)
    series.push({ weekStart, count: byWeek.get(weekStart) ?? 0 })
  }
  return series
}
