import {
  propertyWallClockAt,
  shiftPropertyLocalDays,
} from '#/shared/domain/property-calendar'
import { localMidnight } from '../domain/local-days'
import { localDaysWindow, priorPeriodDates } from './time-range.server'
import type { PortalResultsTimeRange } from './get-portal-results-overview.server'

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
  if (preset === 'last-month')
    return {
      startDate: localMidnight(day.year, day.month - 1, 1, timezone),
      endDate: localMidnight(day.year, day.month, 1, timezone),
    }
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
  const date =
    preset === 'month' ? 1 : preset === 'week' ? day.day - ((weekday + 6) % 7) : day.day
  return { startDate: localMidnight(day.year, day.month, date, timezone), endDate: now }
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
