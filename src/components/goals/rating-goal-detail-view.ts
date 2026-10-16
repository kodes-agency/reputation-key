// The detail page of the Property Google rating goal, worked out (pure; round
// 5, PLAN-D D-2, mock D3): the header's sentences under the headline (when the
// goal arrives at the card's own pace, where Google stands against where it
// started, the number possible after it, and the other pace once the goal
// works at its actual one), the three tiles of "Your plan, so far" and how
// fresh Google's numbers are. Every time is a duration, never a date (R4-3).
import type {
  RatingGoalDetailView,
  RatingGoalPlanProgressView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { arrivalSentence, possibleSentence } from './rating-goal-arrival-words'
import { actualPaceText, paceText } from './rating-goal-pace-words'
import { whenText } from './rating-goal-setup-time'
import { assumedAverageWords, reviewsText, tenthsText } from './rating-goal-view'

type Detail = RatingGoalDetailView

const tenthsOf = (rating: number): number => Math.round(rating * 10)

/** The header gives a time only while the goal climbs on current numbers it can reach. */
const gives = (detail: Detail): boolean =>
  detail.state === 'active' &&
  !detail.googleShowsSoon &&
  detail.status !== 'reviews_too_low' &&
  detail.status !== 'waiting_for_google'

/**
 * "Google shows 4.0 today, up from 3.9 when you started." (or "as when you
 * started", or "down from"); none while Google's numbers are stale.
 */
function startedText(detail: Detail): string | null {
  const shows = detail.google?.shows
  if (shows === null || shows === undefined || detail.google?.current === false)
    return null
  const today = tenthsOf(shows)
  const start = tenthsOf(detail.baseline.googleShows)
  const now = `Google shows ${tenthsText(today)} today`
  if (today === start) return `${now}, as when you started.`
  return `${now}, ${today > start ? 'up' : 'down'} from ${tenthsText(start)} when you started.`
}

/**
 * Q8, "the detail shows both": once the goal works at the pace of the last four
 * weeks, the time at the chosen pace too ("At your 1 a day: in about 3
 * months."), when it reads differently.
 */
function otherPaceText(detail: Detail): string | null {
  const chosen = detail.forecastAtChosenPace
  const pace = detail.paceTenthsPerWeek
  if (
    detail.forecastBasis !== 'actual_pace' ||
    chosen?.kind !== 'days' ||
    pace === null
  ) {
    return null
  }
  const when = whenText(chosen.central)
  const actual = detail.forecast
  if (actual?.kind === 'days' && whenText(actual.central) === when) return null
  return `At your ${paceText(pace)}: ${when}.`
}

export type DetailHeaderLines = Readonly<{
  arrival: string | null
  started: string | null
  possible: string | null
  otherPace: string | null
}>

/** The sentences under the detail's headline; none for a goal this read found reached or ended. */
export function detailHeaderLines(detail: Detail): DetailHeaderLines {
  if (detail.state !== 'active') {
    return { arrival: null, started: null, possible: null, otherPace: null }
  }
  const timed = gives(detail)
  return {
    arrival: timed ? arrivalSentence(detail, assumedAverageWords(detail)) : null,
    started: startedText(detail),
    possible: timed ? possibleSentence(detail) : null,
    otherPace: timed ? otherPaceText(detail) : null,
  }
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

/** One tile of "Your plan, so far": what happened against the plan. */
export type DetailTile = Readonly<{ label: string; value: string; detail: string }>

/** "4.61★": an average of new reviews, to the hundredth, never rounded onto a tenth it is not. */
const starsSoFar = (average: number): string =>
  `${formatNumber(average, { maximumFractionDigits: 2 })}★`

/**
 * What the goal's numbers assume, after the count: the plan mixed with the new
 * reviews, or their own average while they are too low (round 4, X3).
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

/** "Last 4 weeks · up from about 2 a month before the goal". */
function paceNote(detail: Detail): string {
  const before = detail.planSoFar.prePlan
  if (before === null) return 'Last 4 weeks'
  if (before.perMonth === 0) return 'Last 4 weeks · none in the 4 weeks before the goal'
  const month = `about ${formatNumber(before.perMonth)} a month`
  switch (before.trend) {
    case 'up':
      return `Last 4 weeks · up from ${month} before the goal`
    case 'down':
      return `Last 4 weeks · down from ${month} before the goal`
    case 'same':
      return `Last 4 weeks · ${month} before the goal too`
  }
}

function paceTile(detail: Detail, plan: RatingGoalPlanProgressView): DetailTile {
  return {
    label: 'Pace',
    value: `${actualPaceText(plan.lastFourWeeksPerWeek, plan.paceTenthsPerWeek)} · plan ${paceText(plan.paceTenthsPerWeek)}`,
    detail: paceNote(detail),
  }
}

/** The new reviews' average against the plan: "after 10 reviews" until there are ten (R2-5). */
function averageTile(plan: RatingGoalPlanProgressView): DetailTile {
  const planned = `plan ${tenthsText(plan.qualityTenths)}★`
  const { average } = plan.sinceSet
  return {
    label: 'New reviews average',
    value:
      average === null
        ? `after 10 reviews · ${planned}`
        : `${starsSoFar(average)} · ${planned}`,
    detail: sinceSetNote(plan),
  }
}

/** The goal's next step and the number after it: only while the goal climbs. */
function aheadOf(detail: Detail): Pick<Detail, 'next' | 'nextUp'> {
  return detail.state === 'active'
    ? { next: detail.next, nextUp: detail.nextUp }
    : { next: null, nextUp: null }
}

function stepsNote(detail: Detail, up: Detail['nextUp']): string {
  const goal = tenthsText(detail.targetTenths)
  if (detail.state !== 'active') return `Your goal was ${goal}`
  return up === null
    ? `Your goal is ${goal}`
    : `After ${goal}: ${tenthsText(up.targetTenths)} is about ${formatNumber(up.reviewsBeyondGoal)} more`
}

/** "4.0 reached · 4.1 next", and what the number after the goal takes. */
function stepsTile(detail: Detail): DetailTile {
  const reached = detail.planSoFar.reachedTenths
  const ahead = aheadOf(detail)
  const next = ahead.next?.targetTenths ?? null
  const parts = [
    reached === null ? null : `${tenthsText(reached)} reached`,
    next === null ? null : `${tenthsText(next)} next`,
  ].filter((part) => part !== null)
  return {
    label: 'Steps',
    value:
      parts.length === 0 ? `Goal ${tenthsText(detail.targetTenths)}` : parts.join(' · '),
    detail: stepsNote(detail, ahead.nextUp),
  }
}

/** "Your plan, so far" (D3): the pace, the new reviews' average and the steps; none to keep. */
export function planSoFarTiles(detail: Detail): readonly DetailTile[] {
  const plan = detail.plan
  if (plan === null) return []
  return [paceTile(detail, plan), averageTile(plan), stepsTile(detail)]
}
