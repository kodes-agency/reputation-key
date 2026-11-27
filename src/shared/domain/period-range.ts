// Tenant-timezone day keys and calendar period boundaries.

import {
  exactInstantsForWallClock,
  propertyWallClockAt,
  type PropertyWallClock,
} from '#/shared/domain/property-calendar'

/** Tenant-timezone day bucket key (yyyy_MM_dd) for streak/calendar logic. */
export function dayKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('-', '_')
}

export type CalendarPeriodKind = 'weekly' | 'monthly' | 'quarterly'

/** The day of the month (1-31) on the calendar of an IANA timezone. */
export function localDayOfMonth(date: Date, timezone: string): number {
  return propertyWallClockAt(date, timezone).day
}

/**
 * A repeated local time (a DST fall-back) resolves to its LATER, standard-time
 * occurrence, as PostgreSQL's `AT TIME ZONE` does. The database derives the
 * Goal months it accepts that way, so the app must agree with it. A skipped
 * local time still throws rather than guess.
 */
function wallClockToInstant(target: PropertyWallClock, timezone: string): Date {
  const latest = exactInstantsForWallClock(target, timezone).at(-1)
  if (latest) return latest
  throw new RangeError(`Unresolvable calendar boundary in timezone ${timezone}`)
}

/** Half-open current calendar period in the property's IANA timezone. */
export function calendarPeriodRange(
  now: Date,
  timezone: string,
  kind: CalendarPeriodKind,
): Readonly<{ start: Date; end: Date }> {
  const local = propertyWallClockAt(now, timezone)
  const startDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  if (kind === 'weekly') {
    const day = startDate.getUTCDay()
    startDate.setUTCDate(startDate.getUTCDate() + (day === 0 ? -6 : 1 - day))
  } else {
    startDate.setUTCDate(1)
    if (kind === 'quarterly') {
      startDate.setUTCMonth(Math.floor(startDate.getUTCMonth() / 3) * 3)
    }
  }
  const endDate = new Date(startDate)
  if (kind === 'weekly') endDate.setUTCDate(endDate.getUTCDate() + 7)
  else endDate.setUTCMonth(endDate.getUTCMonth() + (kind === 'quarterly' ? 3 : 1))
  const boundary = (date: Date): PropertyWallClock => ({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  })
  return {
    start: wallClockToInstant(boundary(startDate), timezone),
    end: wallClockToInstant(boundary(endDate), timezone),
  }
}
