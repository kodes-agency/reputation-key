// Convert instants to Property-local dates before calendar arithmetic, so DST
// does not change day counts. Shared by Results series and monthly goals.

import { propertyWallClockAt } from '#/shared/domain/property-calendar'

const MS_PER_DAY = 86_400_000

const pad = (value: number): string => String(value).padStart(2, '0')

function utcDay(localDate: string): number {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** The Property-local calendar date of an instant, as `YYYY-MM-DD`. */
export function localDateOf(date: Date, timezone: string): string {
  const { year, month, day } = propertyWallClockAt(date, timezone)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function addLocalDays(localDate: string, days: number): string {
  const moved = new Date(utcDay(localDate) + days * MS_PER_DAY)
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

/** Whole days from one local date to another: 0 for the same day. */
export function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  return Math.round((utcDay(toLocalDate) - utcDay(fromLocalDate)) / MS_PER_DAY)
}
