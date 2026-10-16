// How a Google rating goal's pace reads, in setup and in tracking (rounds 3 and
// 4, R3-7). A pace is stored in tenths of a review a week; a plan reads per day
// ("2 a day"), or per week under one a day ("3 a week"), and progress is counted
// per week ("This week: 9 of 14"). "a month" is the setup's unit switch, 30.4
// days. One module words it everywhere, from the values the Reporting
// application hands components (never its domain).
import {
  dayTenthsOf,
  perMonthOf,
} from '#/contexts/reporting/application/rating-goal-setup-plan'
import { formatNumber } from '#/lib/format'

/** One review a day, in tenths of a review a week. */
const ONE_A_DAY_TENTHS = 70
const TENTHS = 10

const oneDecimal = (value: number): string =>
  formatNumber(value, { maximumFractionDigits: 1 })

/** True when a pace reads a day: one a day or more. */
export const readsPerDay = (tenthsPerWeek: number): boolean =>
  tenthsPerWeek >= ONE_A_DAY_TENTHS

/** "1.4 a week": a pace a week, one decimal at most. */
const weekWords = (tenthsPerWeek: number): string =>
  `${oneDecimal(tenthsPerWeek / TENTHS)} a week`

/** "20 a month". */
export const monthText = (tenthsPerWeek: number): string =>
  `${formatNumber(perMonthOf(tenthsPerWeek))} a month`

/** "2 a day" (one decimal), "3 a week" under one a day, or "60 a month". */
export function paceText(tenthsPerWeek: number, unit: 'day' | 'month' = 'day'): string {
  if (unit === 'month') return monthText(tenthsPerWeek)
  if (!readsPerDay(tenthsPerWeek)) return weekWords(tenthsPerWeek)
  return `${oneDecimal(dayTenthsOf(tenthsPerWeek) / TENTHS)} a day`
}

/** The reviews a week a goal is counted against: half up, at least one ("This week: 9 of 14"). */
export const weeklyTarget = (tenthsPerWeek: number): number =>
  Math.max(1, Math.floor((2 * tenthsPerWeek + TENTHS) / (2 * TENTHS)))

/** "10.5 a week": the pace a week with its decimal. */
export const perWeekText = (tenthsPerWeek: number): string => weekWords(tenthsPerWeek)

/** "2 a day · about 14 a week"; under one a day "3 a week · about 13 a month". */
export function paceSentence(tenthsPerWeek: number): string {
  return readsPerDay(tenthsPerWeek)
    ? `${paceText(tenthsPerWeek)} · about ${formatNumber(weeklyTarget(tenthsPerWeek))} a week`
    : `${paceText(tenthsPerWeek)} · about ${monthText(tenthsPerWeek)}`
}

/** The note under a plan's pace: "About 14 a week · 60 a month", or the month alone under one a day. */
export function planPaceNote(tenthsPerWeek: number): string {
  return readsPerDay(tenthsPerWeek)
    ? `About ${formatNumber(weeklyTarget(tenthsPerWeek))} a week · ${monthText(tenthsPerWeek)}`
    : `About ${monthText(tenthsPerWeek)}`
}
