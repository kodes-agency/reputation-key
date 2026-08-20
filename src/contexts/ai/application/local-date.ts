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

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

type CivilDate = Readonly<{ year: number; month: number; day: number }>

function previousDay({ year, month, day }: CivilDate): CivilDate {
  if (day > 1) return { year, month, day: day - 1 }
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  return {
    year: previousYear,
    month: previousMonth,
    day: daysInMonth(previousYear, previousMonth),
  }
}

function nextDay({ year, month, day }: CivilDate): CivilDate {
  if (day < daysInMonth(year, month)) return { year, month, day: day + 1 }
  return month === 12
    ? { year: year + 1, month: 1, day: 1 }
    : { year, month: month + 1, day: 1 }
}

function format({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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
  let civil = { year, month, day }
  for (let step = 0; step < Math.abs(delta); step += 1) {
    civil = delta < 0 ? previousDay(civil) : nextDay(civil)
  }
  return format(civil)
}
