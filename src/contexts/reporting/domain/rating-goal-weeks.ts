// Property Google rating goal — Monday-to-Sunday weeks (pure).
//
// "This week" and the detail's chart count reviews in Monday-to-Sunday
// weeks of the Property's time zone (the owner's default); the card names the
// day of that week ("It’s Tuesday") from the server, so the page and its first
// paint agree (PLAN-D E9). The detail's chart counts whole Property-local days
// from today on the civil calendar, so a daylight-saving night never makes a
// day 23 or 25 hours long. A week is named
// by its Monday (`YYYY-MM-DD`), the same key PostgreSQL's
// `date_trunc('week', ts AT TIME ZONE tz)` produces, and starts at local
// midnight on that Monday, whatever the clocks did that weekend.

import {
  propertyWallClockAt,
  propertyWallClockToInstant,
} from '#/shared/domain/property-calendar'

/** The detail's chart starts this many weeks before the week a goal was set (PLAN-D §4.3). */
const CHART_WEEKS_BEFORE_SET = 4
/** And a year back at most. */
const CHART_MAX_WEEKS = 52
const DAY_MS = 24 * 60 * 60 * 1000

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

/** Days since Monday of a civil date: 0 on Monday, 6 on Sunday. */
const daysSinceMonday = (date: CivilDate): number =>
  (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7

/** The Monday of a civil date's week. */
const mondayOf = (date: CivilDate): CivilDate => addDays(date, -daysSinceMonday(date))

const dateOfKey = (key: string): CivilDate => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  return { year, month, day }
}

/** Days since 1970-01-01 of a civil date: no time zone, no daylight saving. */
const dayNumber = (date: CivilDate): number =>
  Date.UTC(date.year, date.month - 1, date.day) / DAY_MS

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

/** The day of the Property-local week an instant falls on: 1 Monday … 7 Sunday. */
export const propertyWeekday = (instant: Date, timezone: string): number =>
  daysSinceMonday(civilDateAt(instant, timezone)) + 1

/** The instant the Property-local week of `instant` starts: Monday, 00:00. */
export const weekStartInstant = (instant: Date, timezone: string): Date =>
  instantOf(mondayOf(civilDateAt(instant, timezone)), timezone)

/** Whole Property-local days from today to a date `YYYY-MM-DD`: negative before today. */
export const daysFromToday = (dateKey: string, now: Date, timezone: string): number =>
  dayNumber(dateOfKey(dateKey)) - dayNumber(civilDateAt(now, timezone))

/** Whole Property-local days from today to the local date an instant falls on. */
export const dayOfInstant = (instant: Date, now: Date, timezone: string): number =>
  daysFromToday(keyOf(civilDateAt(instant, timezone)), now, timezone)

/** A date `YYYY-MM-DD` moved by whole days. */
export const shiftDateKey = (dateKey: string, days: number): string =>
  keyOf(addDays(dateOfKey(dateKey), days))

/**
 * Where the detail's chart starts: four weeks before the Monday of the week a
 * goal was set, or 52 weeks before this one when that is later. The Monday,
 * and the instant it starts in the Property's zone.
 */
export function chartStart(
  since: Date,
  now: Date,
  timezone: string,
): Readonly<{ key: string; instant: Date }> {
  const beforeSet = addDays(
    mondayOf(civilDateAt(since, timezone)),
    -7 * CHART_WEEKS_BEFORE_SET,
  )
  const earliest = addDays(mondayOf(civilDateAt(now, timezone)), -7 * CHART_MAX_WEEKS)
  const first = keyOf(beforeSet) < keyOf(earliest) ? earliest : beforeSet
  return { key: keyOf(first), instant: instantOf(first, timezone) }
}

/** Every Monday from `fromKey` (a Monday) to this week's, oldest first. */
export function chartWeeks(fromKey: string, now: Date, timezone: string): string[] {
  const lastKey = weekStartKey(now, timezone)
  const weeks: string[] = []
  for (
    let monday = dateOfKey(fromKey);
    keyOf(monday) <= lastKey;
    monday = addDays(monday, 7)
  ) {
    weeks.push(keyOf(monday))
  }
  return weeks
}
