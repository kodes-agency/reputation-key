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
import { formatNumber } from '#/lib/format'
import {
  assumedAverageWords,
  forecastSentence,
  ratingText,
  reviewsText,
  tenthsText,
} from './rating-goal-view'
import {
  actualPaceText,
  paceText,
  planPaceNote,
  weeklyTarget,
} from './rating-goal-pace-words'

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

/**
 * Both forecasts the detail shows: at the chosen pace and at the actual one.
 * None while new reviews are too low for the target: the page says that once,
 * with what helps, rather than once per pace. A forecast no pace reaches names
 * the average it was worked out at (the plan's, then the new reviews').
 */
export function detailForecasts(
  detail: RatingGoalDetailView,
): readonly Readonly<{ label: string; text: string }>[] {
  const plan = detail.paceTenthsPerWeek
  if (plan === null || detail.status === 'reviews_too_low') return []
  const average = assumedAverageWords(detail)
  const sentence = (forecast: NonNullable<RatingGoalDetailView['forecast']>) =>
    forecastSentence(forecast, detail.target, undefined, average)
  const lines = [
    detail.forecastAtChosenPace === null
      ? null
      : {
          label: `At your chosen pace, ${paceText(plan)}`,
          text: sentence(detail.forecastAtChosenPace),
        },
    detail.forecastAtActualPace === null
      ? null
      : {
          label: `At your pace of the last 4 weeks, ${actualPaceText(detail.lastFourWeeksPerWeek, plan)}`,
          text: sentence(detail.forecastAtActualPace),
        },
  ]
  return lines.filter((line) => line !== null)
}

/** The quiet best case: if every new review is five stars. */
export function bestCaseLine(detail: RatingGoalDetailView): string | null {
  const plan = detail.paceTenthsPerWeek
  if (detail.bestCase === null || plan === null) return null
  return `If every new review is 5★: ${formatNumber(detail.bestCase)} more reviews, ${aboutHowLong(detail.bestCase, plan / 10)} at ${paceText(plan)}.`
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
  const pace = detail.paceTenthsPerWeek
  if (pace === null) return []
  return [
    {
      label: 'This week',
      value: `${formatNumber(detail.thisWeekCount)} of ${formatNumber(weeklyTarget(pace))}`,
      detail: 'new reviews since Monday',
    },
    {
      label: 'Last 4 weeks',
      value: actualPaceText(detail.lastFourWeeksPerWeek, pace),
      detail: `your pace is ${paceText(pace)}`,
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
  paceTenthsPerWeek: number | null,
): string {
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const span = `${formatNumber(total)} new ${total === 1 ? 'review' : 'reviews'} in ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}`
  return paceTenthsPerWeek === null
    ? `${span}.`
    : `${span}; the plan is ${paceText(paceTenthsPerWeek)}.`
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

/**
 * What the forecasts assume, after the count: the plan mixed with the new
 * reviews, or their own average while they are too low (round 4, X3).
 */
function sinceSetNote(plan: RatingGoalPlanProgressView): string {
  const { reviewCount } = plan.sinceSet
  if (reviewCount === 0) return 'No new reviews since the goal was set'
  const since = `${reviewsText(reviewCount)} since the goal was set`
  switch (plan.qualityBasis) {
    case 'since_set':
      return `${since} · forecasts use their average`
    case 'blended':
      return `${since} · forecasts use ${starsSoFar(plan.assumedAverage)}, your plan mixed with them`
    case 'planned':
      return since
  }
}

function newReviewsLine(plan: RatingGoalPlanProgressView): PlanLine {
  const planned = `plan ${tenthsText(plan.qualityTenths)}★`
  const { average } = plan.sinceSet
  return {
    term: 'New reviews average',
    value:
      average === null
        ? `after 10 reviews · ${planned}`
        : `${starsSoFar(average)} · ${planned}`,
    note: sinceSetNote(plan),
  }
}

/**
 * "Your plan" (R2-11): the goal against what Google shows now, the planned
 * average against the reviews since the goal was set ("after 10 reviews" until
 * there are ten, as the verdict waits) with the average the forecasts use, and
 * the chosen pace against the last four weeks.
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
      value: `${actualPaceText(plan.lastFourWeeksPerWeek, plan.paceTenthsPerWeek)} · plan ${paceText(plan.paceTenthsPerWeek)}`,
      note: planPaceNote(plan.paceTenthsPerWeek),
    },
  ]
}
