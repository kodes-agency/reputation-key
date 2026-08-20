/**
 * Property-local date arithmetic on `YYYY-MM-DD` strings.
 *
 * The AI aggregate tables are keyed by the property's LOCAL date, resolved
 * through the property calendar profile, never by a UTC instant. Doing this
 * arithmetic with `Date` would reintroduce the timezone the calendar exists to
 * remove, so it stays string-to-string and throws on anything malformed rather
 * than silently rolling over.
 *
 * Extracted verbatim from `generate-property-trend.ts`, which was its only
 * caller until the dashboard aggregate read needed the same window maths.
 * Deliberately unchanged: a subtler loop would be faster and would risk showing
 * the wrong days.
 */

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

export function addDays(localDate: string, delta: number): string {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(localDate)
  if (match === null || !Number.isSafeInteger(delta)) {
    throw new TypeError('invalid property-local date arithmetic input')
  }
  let year = Number(match[1])
  let month = Number(match[2])
  let day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError('invalid property-local date')
  }
  let remaining = delta
  while (remaining < 0) {
    if (day > 1) day -= 1
    else {
      month -= 1
      if (month === 0) {
        year -= 1
        month = 12
      }
      day = daysInMonth(year, month)
    }
    remaining += 1
  }
  while (remaining > 0) {
    if (day < daysInMonth(year, month)) day += 1
    else {
      day = 1
      month += 1
      if (month === 13) {
        year += 1
        month = 1
      }
    }
    remaining -= 1
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
