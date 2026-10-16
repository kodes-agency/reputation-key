// How long a goal takes, in the setup's words (rounds 3 and 4, the approved
// mock's `span` and `rangeOf`). Days arrive as exact integer fractions and every
// threshold is compared on them, so no float decides which words are shown:
// under 14 days in days, under 70 in weeks, under 349.6 in months (30.4 days),
// then about a year, about N years, and more than 3 years past 1,095 days. A
// likely range reads "a weeks to b months" when its fast end is under 70 days
// (PLAN-R4 D16: the week/month boundary, which reproduces the four approved
// ranges where the mock's 60 would turn "9 weeks to 4 months" into "2–4 months").
import type { RatingFraction } from '#/contexts/reporting/application/dto/rating-goal-setup.types'

const IN_DAYS_BELOW = 14
const IN_WEEKS_BELOW = 70
/** 349.6 days, in tenths of a day. */
const IN_MONTHS_BELOW_TENTHS = 3496
/** 30.4 days, in tenths. */
const MONTH_TENTHS = 304
const YEAR_DAYS = 365
const MORE_THAN_DAYS = 3 * YEAR_DAYS

/** round(num / den), half up, for non-negative integers. */
const roundHalfUp = (num: number, den: number): number =>
  Math.floor((2 * num + den) / (2 * den))

const below = (days: RatingFraction, limit: number): boolean =>
  days.num < limit * days.den
const belowMonths = (days: RatingFraction): boolean =>
  10 * days.num < IN_MONTHS_BELOW_TENTHS * days.den
const beyondThreeYears = (days: RatingFraction): boolean =>
  days.num > MORE_THAN_DAYS * days.den

const inDays = (days: RatingFraction): number =>
  Math.max(1, roundHalfUp(days.num, days.den))
const inWeeks = (days: RatingFraction): number =>
  Math.max(1, roundHalfUp(days.num, 7 * days.den))
const inMonths = (days: RatingFraction): number =>
  Math.max(1, roundHalfUp(10 * days.num, MONTH_TENTHS * days.den))

const plural = (count: number, unit: string): string =>
  `${count} ${count === 1 ? unit : `${unit}s`}`

/** "about 3 months", "about a year", "more than 3 years". */
export function spanText(days: RatingFraction): string {
  if (below(days, IN_DAYS_BELOW)) return `about ${plural(inDays(days), 'day')}`
  if (below(days, IN_WEEKS_BELOW)) return `about ${plural(inWeeks(days), 'week')}`
  if (belowMonths(days)) return `about ${plural(inMonths(days), 'month')}`
  if (beyondThreeYears(days)) return 'more than 3 years'
  const years = roundHalfUp(days.num, YEAR_DAYS * days.den)
  return years <= 1 ? 'about a year' : `about ${years} years`
}

/** "in about 3 months", or "more than 3 years away". */
export const whenText = (days: RatingFraction): string =>
  beyondThreeYears(days) ? 'more than 3 years away' : `in ${spanText(days)}`

/** "a–b unit", or "a unit" when the ends meet. */
function between(a: number, b: number, unit: string): string {
  return a === b ? plural(a, unit) : `${a}–${b} ${unit}s`
}

/** The span without its "about": "3 months". */
const bare = (days: RatingFraction): string => spanText(days).replace(/^about /u, '')

/** "3 months or more", "a year or more", or "more than 3 years". */
const fromFast = (fast: RatingFraction): string =>
  beyondThreeYears(fast) ? bare(fast) : `${bare(fast)} or more`

/**
 * "9 weeks to 4 months", "3–6 months", "3–10 weeks", "3 months or more" when
 * the slow end is open, "3 months to over a year" when it is that far, and
 * "a year or more" when the fast end is a year or more itself.
 */
export function likelyText(
  likely: Readonly<{ fast: RatingFraction; slow: RatingFraction | null }>,
): string {
  const { fast, slow } = likely
  if (slow === null || !belowMonths(fast)) return fromFast(fast)
  if (below(slow, IN_DAYS_BELOW)) {
    const a = inDays(fast)
    return between(a, Math.max(a, inDays(slow)), 'day')
  }
  if (below(slow, IN_WEEKS_BELOW)) {
    const a = inWeeks(fast)
    return between(a, Math.max(a, inWeeks(slow)), 'week')
  }
  if (belowMonths(slow)) {
    if (below(fast, IN_WEEKS_BELOW)) {
      return `${plural(inWeeks(fast), 'week')} to ${plural(inMonths(slow), 'month')}`
    }
    const a = inMonths(fast)
    return between(a, Math.max(a, inMonths(slow)), 'month')
  }
  return `${bare(fast)} to over a year`
}
