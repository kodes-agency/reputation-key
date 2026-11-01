import {
  propertyWallClockAt,
  propertyWallClockToInstant,
  shiftPropertyLocalDays,
} from '#/shared/domain/property-calendar'

export type StaffPeriod = 'today' | 'week' | 'month'

export function staffResultsWindow(
  now: Date,
  timezone: string,
  countryCode: string | null,
  period: StaffPeriod,
) {
  const wall = propertyWallClockAt(now, timezone)
  const midnight = propertyWallClockToInstant(
    { ...wall, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  )
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
