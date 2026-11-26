/**
 * Property-local date arithmetic on `YYYY-MM-DD` strings.
 *
 * The AI aggregate tables are keyed by the property's LOCAL date, resolved
 * through the property calendar profile, never by a UTC instant. The moves are
 * calendar-day arithmetic on the date alone (`addLocalDays`), and anything
 * malformed throws rather than silently rolling over.
 */
import { addLocalDays } from '#/shared/domain/local-days'

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

export function addDays(localDate: string, delta: number): string {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(localDate)
  if (match === null || !Number.isSafeInteger(delta)) {
    throw new TypeError('invalid property-local date arithmetic input')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError('invalid property-local date')
  }
  return addLocalDays(localDate, delta)
}
