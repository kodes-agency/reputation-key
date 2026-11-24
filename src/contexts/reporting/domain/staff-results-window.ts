import {
  propertyWallClockAt,
  shiftPropertyLocalDays,
} from '#/shared/domain/property-calendar'
import { addLocalDays, localDateOf, localMidnight } from './local-days'

export type StaffPeriod = 'today' | 'week' | 'month' | 'last_month'

export function staffResultsWindow(
  now: Date,
  timezone: string,
  countryCode: string | null,
  period: StaffPeriod,
) {
  const wall = propertyWallClockAt(now, timezone)
  const midnight = localMidnight(wall.year, wall.month, wall.day, timezone)
  if (period === 'last_month') {
    const endAt = localMidnight(wall.year, wall.month, 1, timezone)
    const startAt = localMidnight(wall.year, wall.month - 1, 1, timezone)
    return { startAt, endAt, ratingsCutoff: midnight }
  }
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()
  const days =
    period === 'month'
      ? wall.day - 1
      : period === 'week'
        ? (weekday + (countryCode === 'US' ? 0 : 6)) % 7
        : 0
  return {
    startAt: shiftPropertyLocalDays(midnight, -days, timezone),
    endAt: now,
    ratingsCutoff: midnight,
  }
}

export type StaffResultsSeries = Readonly<{
  unit: 'day' | 'week'
  /** `start` is a Property day, YYYY-MM-DD. `open` is still counting. */
  columns: readonly Readonly<{ start: string; scans: number; open: boolean }>[]
}>

/** Whole Property days, first to last, counted on the calendar so a clock change cannot skip one. */
function localDaysFromTo(first: string, last: string) {
  const days: string[] = []
  for (let day = first; day <= last; day = addLocalDays(day, 1)) days.push(day)
  return days
}

/**
 * The bars under a person's scans: each day of this week, each week of a month
 * (Monday to Sunday, Sunday to Saturday in the US, as the week above). Today has
 * none: one number says it.
 */
export function staffResultsSeries(
  now: Date,
  timezone: string,
  countryCode: string | null,
  period: StaffPeriod,
  scansByDay: ReadonlyMap<string, number>,
): StaffResultsSeries | null {
  if (period === 'today') return null
  const { startAt, endAt } = staffResultsWindow(now, timezone, countryCode, period)
  const lastAt = period === 'last_month' ? new Date(endAt.getTime() - 1) : now
  const days = localDaysFromTo(
    localDateOf(startAt, timezone),
    localDateOf(lastAt, timezone),
  )
  const scansOn = (day: string) => scansByDay.get(day) ?? 0
  if (period === 'week')
    return {
      unit: 'day',
      columns: days.map((start, index) => ({
        start,
        scans: scansOn(start),
        open: index === days.length - 1,
      })),
    }
  const weekStartsOn = countryCode === 'US' ? 0 : 1
  const weeks = days.reduce<readonly (readonly string[])[]>((groups, day, index) => {
    const startsWeek = new Date(`${day}T00:00:00Z`).getUTCDay() === weekStartsOn
    return index === 0 || startsWeek
      ? [...groups, [day]]
      : [...groups.slice(0, -1), [...(groups.at(-1) ?? []), day]]
  }, [])
  return {
    unit: 'week',
    columns: weeks.map((week, index) => ({
      start: week[0] ?? '',
      scans: week.reduce((sum, day) => sum + scansOn(day), 0),
      open: period === 'month' && index === weeks.length - 1,
    })),
  }
}
