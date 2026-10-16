// When a Google rating goal arrives, in words (round 5, PLAN-D E1): durations
// from today in the setup's own words ("in about 3 months, likely 9 weeks to 4
// months"), never a calendar month or date, so the card agrees with the
// receipt the setup just showed. The card says it at the pace it works with
// (Q8: the chosen one for 28 days, then the last 4 weeks') and names it.
// The wizard's arrival on the page is `rating-goal-arrival.ts`, a different
// thing.
import type {
  RatingArrivalView,
  RatingGoalCardView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type { RatingFraction } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { paceText } from './rating-goal-pace-words'
import { likelyText, spanText, whenText } from './rating-goal-setup-time'
import { ratingText } from './rating-goal-view'

type DaysArrival = Extract<RatingArrivalView, { kind: 'days' }>

/** Three years: past it a time is "more than 3 years away", with no range. */
const THREE_YEARS_DAYS = 3 * 365

/** Whether a time is within three years: past it the card names no number or range. */
const withinThreeYears = (days: RatingFraction): boolean =>
  days.num <= THREE_YEARS_DAYS * days.den

const beyondThreeYears = (arrival: DaysArrival): boolean =>
  !withinThreeYears(arrival.central)

/** "in about 3 months, likely 9 weeks to 4 months". */
const whenLikely = (arrival: DaysArrival): string =>
  `${whenText(arrival.central)}, likely ${likelyText(arrival)}`

/** Why there is no time to give, or that Google is about to show it. */
function noTime(
  arrival: Exclude<RatingArrivalView, DaysArrival>,
  target: number,
  average: string,
): string {
  switch (arrival.kind) {
    case 'unreachable':
      return `No pace reaches ${ratingText(target)} ${average}.`
    case 'no_pace':
      return 'No new reviews in the last 4 weeks to work out when.'
    case 'earned':
      return `Google should show ${ratingText(target)} soon.`
  }
}

/**
 * One arrival as a line of its own: "In about 3 months, likely 9 weeks to 4
 * months.", "More than 3 years away.", or why there is none. A target no pace
 * reaches names the average it was worked out at.
 */
export function arrivalLine(
  arrival: RatingArrivalView,
  target: number,
  average: string,
): string {
  if (arrival.kind !== 'days') return noTime(arrival, target, average)
  if (beyondThreeYears(arrival)) return 'More than 3 years away.'
  const words = whenLikely(arrival)
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
}

/** "at your 1 a day", "at your pace of the last 4 weeks". */
function paceWords(
  card: Pick<RatingGoalCardView, 'forecastBasis' | 'paceTenthsPerWeek'>,
) {
  if (card.forecastBasis === 'actual_pace' || card.paceTenthsPerWeek === null) {
    return 'at your pace of the last 4 weeks'
  }
  return `at your ${paceText(card.paceTenthsPerWeek)}`
}

/**
 * The card's arrival: "4.1 in about 3 months at your 1 a day, likely 9 weeks
 * to 4 months.", "4.1 is more than 3 years away at this pace.", or why there is
 * no time. Null without an arrival (a keep goal).
 */
export function arrivalSentence(
  card: Pick<
    RatingGoalCardView,
    'forecast' | 'forecastBasis' | 'paceTenthsPerWeek' | 'target'
  >,
  average: string,
): string | null {
  const arrival = card.forecast
  if (arrival === null) return null
  if (arrival.kind !== 'days') return noTime(arrival, card.target, average)
  const target = ratingText(card.target)
  if (beyondThreeYears(arrival))
    return `${target} is more than 3 years away at this pace.`
  return `${target} ${whenText(arrival.central)} ${paceWords(card)}, likely ${likelyText(arrival)}.`
}

/**
 * The narrow card's arrival (D4): "4.1 in about 3 months", or "4.1 is more than
 * 3 years away"; the pace and the likely range are on the wide card and the
 * detail. Null without a time, where the full sentence says why.
 */
export function shortArrival(
  card: Pick<RatingGoalCardView, 'forecast' | 'target'>,
): string | null {
  const arrival = card.forecast
  if (arrival?.kind !== 'days') return null
  const target = ratingText(card.target)
  return beyondThreeYears(arrival)
    ? `${target} is more than 3 years away`
    : `${target} ${whenText(arrival.central)}`
}

/**
 * "4.2 is possible in about 6 months." (R4-4); none past three years, nor while
 * the card waits for Google's latest numbers (it gives no time then). The
 * ladder's "possible" rung follows this sentence.
 */
export function possibleSentence(
  card: Pick<RatingGoalCardView, 'nextUp' | 'status'>,
): string | null {
  const up = card.nextUp
  if (up === null || card.status === 'waiting_for_google' || !withinThreeYears(up.days))
    return null
  return `${ratingText(up.targetTenths / 10)} is possible in ${spanText(up.days)}.`
}
