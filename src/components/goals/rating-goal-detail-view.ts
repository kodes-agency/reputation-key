// The detail page of the Property Google rating goal, worked out (pure): the
// full monitoring view the simple card leaves out. "Your plan" against what
// happened since it was set (round 2, R2-11), forecasts at the chosen pace and
// at the pace of the last four weeks, the best case, the bar from where the
// goal started to the line Google shows the target at, the next tenth, the
// tiles, the star mix and how fresh Google's numbers are (ADR 0067, decision 7).
import type {
  RatingGoalDetailView,
  RatingGoalPlanProgressView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalPaceView } from '#/contexts/reporting/application/rating-goal-preview'
import { formatNumber } from '#/lib/format'
import {
  assumedAverageWords,
  forecastSentence,
  perMonthAndDay,
  ratingText,
  reviewsText,
  tenthsText,
} from './rating-goal-view'

const WEEKS_A_YEAR = 52
/** Below this many weeks a span reads in weeks; below this many months, in months. */
const IN_WEEKS_BELOW = 8
const IN_MONTHS_BELOW = 24

const twoDecimals = (value: number): string =>
  formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "about 3 weeks", "about 4 months", "about 2.3 years": a count of reviews at a pace. */
export function aboutHowLong(reviews: number, perWeek: number): string {
  const weeks = reviews / perWeek
  if (weeks < IN_WEEKS_BELOW) {
    const whole = Math.max(1, Math.ceil(weeks))
    return `about ${whole} ${whole === 1 ? 'week' : 'weeks'}`
  }
  const months = Math.round((weeks * 12) / WEEKS_A_YEAR)
  if (months < IN_MONTHS_BELOW) return `about ${months} months`
  return `about ${formatNumber(weeks / WEEKS_A_YEAR, { maximumFractionDigits: 1 })} years`
}

const perWeekText = (perWeek: number): string =>
  `${formatNumber(perWeek, { maximumFractionDigits: 2 })} a week`

/**
 * Both forecasts the detail shows: at the chosen pace and at the actual one.
 * None while new reviews are too low for the target: the page says that once,
 * with what helps, rather than once per pace. A forecast no pace reaches names
 * the average it was worked out at (the plan's, then the new reviews').
 */
export function detailForecasts(
  detail: RatingGoalDetailView,
): readonly Readonly<{ label: string; text: string }>[] {
  if (detail.pacePerWeek === null || detail.status === 'reviews_too_low') return []
  const average = assumedAverageWords(detail)
  const sentence = (forecast: NonNullable<RatingGoalDetailView['forecast']>) =>
    forecastSentence(forecast, detail.target, undefined, average)
  const lines = [
    detail.forecastAtChosenPace === null
      ? null
      : {
          label: `At your chosen pace, ${perWeekText(detail.pacePerWeek)}`,
          text: sentence(detail.forecastAtChosenPace),
        },
    detail.forecastAtActualPace === null
      ? null
      : {
          label: `At your pace of the last 4 weeks, ${perWeekText(detail.lastFourWeeksPerWeek)}`,
          text: sentence(detail.forecastAtActualPace),
        },
  ]
  return lines.filter((line) => line !== null)
}

/** The quiet best case: if every new review is five stars. */
export function bestCaseLine(detail: RatingGoalDetailView): string | null {
  if (detail.bestCase === null || detail.pacePerWeek === null) return null
  return `If every new review is 5★: ${formatNumber(detail.bestCase)} more reviews, ${aboutHowLong(detail.bestCase, detail.pacePerWeek)} at ${perWeekText(detail.pacePerWeek)}.`
}

/**
 * The bar runs from the exact average the goal started at to the line Google
 * shows the target at. The next tenth is marked on it when it is short of the
 * target.
 */
export function progressMarks(detail: RatingGoalDetailView): Readonly<{
  value: number
  marker: number | null
  start: string
  end: string
}> {
  const from = detail.baseline.exactAverage
  const span = detail.threshold - from
  const next = detail.nextTenth
  const marker =
    next !== null && next.targetTenths < detail.targetTenths && span > 0
      ? (next.target - 0.05 - from) / span
      : null
  return {
    value: detail.progress ?? 0,
    marker: marker === null ? null : Math.min(1, Math.max(0, marker)),
    start: `Started at ${twoDecimals(from)}`,
    end: `${twoDecimals(detail.threshold)} shows ${ratingText(detail.target)}`,
  }
}

/** "Next: Google shows 4.4 after about 31 more reviews". */
export function nextTenthLine(detail: RatingGoalDetailView): string | null {
  const next = detail.nextTenth
  if (next === null) return null
  const shows = `Next: Google shows ${ratingText(next.target)}`
  return next.reviewsNeeded === null
    ? `${shows} — not reachable ${assumedAverageWords(detail)}`
    : `${shows} after about ${formatNumber(next.reviewsNeeded)} more ${next.reviewsNeeded === 1 ? 'review' : 'reviews'}`
}

export type DetailTile = Readonly<{ label: string; value: string; detail: string }>

/** This week against the pace, the last four weeks, and what is still needed. */
export function detailTiles(detail: RatingGoalDetailView): readonly DetailTile[] {
  if (detail.pacePerWeek === null) return []
  const pace = detail.pacePerWeek
  return [
    {
      label: 'This week',
      value: `${formatNumber(detail.thisWeekCount)} of ${formatNumber(pace)}`,
      detail: 'new reviews since Monday',
    },
    {
      label: 'Last 4 weeks',
      value: perWeekText(detail.lastFourWeeksPerWeek),
      detail: `your pace is ${perWeekText(pace)}`,
    },
    detail.stillNeeded === null
      ? {
          label: 'Still needed',
          value: 'Not reachable',
          detail: assumedAverageWords(detail),
        }
      : {
          label: 'Still needed',
          value: reviewsText(detail.stillNeeded),
          detail:
            detail.bestCase === null
              ? assumedAverageWords(detail)
              : `best case ${formatNumber(detail.bestCase)}, if every new review is 5★`,
        },
  ]
}

/** "107 reviews since the goal was set · average 4.61★". */
export function starMixSummary(
  stars: readonly Readonly<{ stars: number; count: number }>[],
): string {
  const count = stars.reduce((sum, each) => sum + each.count, 0)
  if (count === 0) return 'No new reviews since the goal was set.'
  const total = stars.reduce((sum, each) => sum + each.stars * each.count, 0)
  return `${reviewsText(count)} since the goal was set · average ${twoDecimals(total / count)}★`
}

/** The weekly chart's one line, which is also its accessible description. */
export function weeklyCaption(
  weeks: readonly Readonly<{ count: number }>[],
  pacePerWeek: number | null,
): string {
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const span = `${formatNumber(total)} new ${total === 1 ? 'review' : 'reviews'} in ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}`
  return pacePerWeek === null
    ? `${span}.`
    : `${span}; the pace is ${perWeekText(pacePerWeek)}.`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (count: number, unit: string): string =>
  `${count} ${count === 1 ? unit : `${unit}s`} ago`

/**
 * How long before the page read them Google's numbers were checked. Counted from
 * the read, not the clock, so the server and the browser print the same words.
 */
export function freshnessText(asOf: string, readAt: Date): string {
  const age = Math.max(0, readAt.getTime() - new Date(asOf).getTime())
  const when =
    age < MINUTE
      ? 'just now'
      : age < HOUR
        ? ago(Math.floor(age / MINUTE), 'minute')
        : age < DAY
          ? ago(Math.floor(age / HOUR), 'hour')
          : ago(Math.floor(age / DAY), 'day')
  return `Google numbers checked ${when}`
}

/** One line of "Your plan": what happened so far against the plan. */
export type PlanLine = Readonly<{ term: string; value: string; note: string | null }>

/** "4.61★": an average of new reviews, to the hundredth, never rounded onto a tenth it is not. */
const starsSoFar = (average: number): string =>
  `${formatNumber(average, { maximumFractionDigits: 2 })}★`

function newReviewsLine(plan: RatingGoalPlanProgressView): PlanLine {
  const planned = `plan ${tenthsText(plan.qualityTenths)}★`
  const { reviewCount, average } = plan.sinceSet
  const since =
    reviewCount === 0
      ? 'No new reviews since the goal was set'
      : `${reviewsText(reviewCount)} since the goal was set`
  return {
    term: 'New reviews average',
    value:
      average === null
        ? `after 10 reviews · ${planned}`
        : `${starsSoFar(average)} · ${planned}`,
    note: since,
  }
}

/**
 * "Your plan" (R2-11): the goal against what Google shows now, the planned
 * average against the reviews since the goal was set ("after 10 reviews" until
 * there are ten), and the chosen pace against the last four weeks.
 */
export function yourPlanLines(plan: RatingGoalPlanProgressView): readonly PlanLine[] {
  const goal = `goal ${tenthsText(plan.targetTenths)}`
  return [
    {
      term: 'Google shows',
      value:
        plan.googleShowsTenths === null
          ? `not known yet · ${goal}`
          : `${tenthsText(plan.googleShowsTenths)} · ${goal}`,
      note: null,
    },
    newReviewsLine(plan),
    {
      term: 'Pace, last 4 weeks',
      value: `${perWeekText(plan.lastFourWeeksPerWeek)} · plan ${perWeekText(plan.pacePerWeek)}`,
      note: `Your plan is ${perMonthAndDay(ratingGoalPaceView(plan.pacePerWeek))}`,
    },
  ]
}
