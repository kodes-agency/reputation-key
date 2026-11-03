import {
  propertyWallClockAt,
  propertyWallClockToInstant,
  shiftPropertyLocalDays,
} from '#/shared/domain/property-calendar'
import { localDaysWindow, priorPeriodDates } from './utils'
import type { PortalResultsTimeRange } from './use-cases/get-portal-results-overview'

export function portalResultsWindow(
  preset: PortalResultsTimeRange,
  now: Date,
  timezone: string,
) {
  if (
    preset !== 'today' &&
    preset !== 'week' &&
    preset !== 'month' &&
    preset !== 'last-month'
  )
    return localDaysWindow(preset, now, timezone)
  const day = propertyWallClockAt(now, timezone)
  const midnight = (year: number, month: number, date: number) => {
    const normalized = new Date(Date.UTC(year, month - 1, date))
    return propertyWallClockToInstant(
      {
        year: normalized.getUTCFullYear(),
        month: normalized.getUTCMonth() + 1,
        day: normalized.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      timezone,
    )
  }
  if (preset === 'last-month')
    return {
      startDate: midnight(day.year, day.month - 1, 1),
      endDate: midnight(day.year, day.month, 1),
    }
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
  const date =
    preset === 'month' ? 1 : preset === 'week' ? day.day - ((weekday + 6) % 7) : day.day
  return { startDate: midnight(day.year, day.month, date), endDate: now }
}

export function portalResultsPrior(
  preset: PortalResultsTimeRange,
  start: Date,
  end: Date,
  timezone: string,
) {
  if (
    preset !== 'today' &&
    preset !== 'week' &&
    preset !== 'month' &&
    preset !== 'last-month'
  )
    return priorPeriodDates(preset, start, end, timezone)
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))
  return {
    priorStartDate: shiftPropertyLocalDays(start, -days, timezone),
    priorEndDate: shiftPropertyLocalDays(end, -days, timezone),
  }
}
