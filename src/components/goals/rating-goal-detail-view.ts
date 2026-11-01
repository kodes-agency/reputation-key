// The detail page of the Property Google rating goal, worked out (pure;
// 2026-11-01, ADR 0067): the sentences under the headline (when the goal arrives at
// the card's own pace, and the other pace once the goal works at its actual one)
// and how fresh Google's numbers are. Every time is a duration, never a date (R4-3).
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { arrivalSentence } from './rating-goal-arrival-words'
import { paceText } from './rating-goal-pace-words'
import { whenText } from './rating-goal-setup-time'
import { assumedAverageWords } from './rating-goal-view'

type Detail = RatingGoalDetailView

/** The header gives a time only while the goal climbs on current numbers it can reach. */
const gives = (detail: Detail): boolean =>
  detail.state === 'active' &&
  !detail.googleShowsSoon &&
  detail.status !== 'reviews_too_low' &&
  detail.status !== 'waiting_for_google'

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
  otherPace: string | null
}>

/** The sentences under the detail's headline; none for a goal this read found reached or ended. */
export function detailHeaderLines(detail: Detail): DetailHeaderLines {
  if (!gives(detail)) return { arrival: null, otherPace: null }
  return {
    arrival: arrivalSentence(detail, assumedAverageWords(detail)),
    otherPace: otherPaceText(detail),
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
