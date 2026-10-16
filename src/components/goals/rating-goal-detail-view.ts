// The detail page of the Property Google rating goal, worked out (pure): "Your
// plan" against what happened since it was set (round 2, R2-11), forecasts at
// the chosen pace and at the pace of the last four weeks, and how fresh
// Google's numbers are (ADR 0067, decision 7).
import type {
  RatingGoalDetailView,
  RatingGoalPlanProgressView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { arrivalLine } from './rating-goal-arrival-words'
import { assumedAverageWords, reviewsText, tenthsText } from './rating-goal-view'
import { actualPaceText, paceText, planPaceNote } from './rating-goal-pace-words'

/**
 * Both forecasts the detail shows: at the chosen pace and at the actual one.
 * None while new reviews are too low for the target: the page says that once,
 * with what helps, rather than once per pace. A forecast no pace reaches names
 * the average it was worked out at (the plan's, the plan mixed with new
 * reviews, or theirs while too low).
 */
export function detailForecasts(
  detail: RatingGoalDetailView,
): readonly Readonly<{ label: string; text: string }>[] {
  const plan = detail.paceTenthsPerWeek
  if (plan === null || detail.status === 'reviews_too_low') return []
  const average = assumedAverageWords(detail)
  const sentence = (forecast: NonNullable<RatingGoalDetailView['forecast']>) =>
    arrivalLine(forecast, detail.target, average)
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
 * What the goal's numbers assume, after the count: the plan mixed with the new
 * reviews, or their own average while they are too low (round 4, X3). A
 * too-low goal shows no forecast, only Still needed, so its note says "the
 * numbers".
 */
function sinceSetNote(plan: RatingGoalPlanProgressView): string {
  const { reviewCount } = plan.sinceSet
  if (reviewCount === 0) return 'No new reviews since the goal was set'
  const since = `${reviewsText(reviewCount)} since the goal was set`
  switch (plan.qualityBasis) {
    case 'since_set':
      return `${since} · the numbers use their average`
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
