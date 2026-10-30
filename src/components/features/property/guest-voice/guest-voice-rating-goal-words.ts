// What Guest voice says of the Google rating goal, as plain functions. The goal is
// Reporting's: the page only reads where it stands and names it beside the top problem,
// as an association and never as advice or a promise (the same words the sections above
// use). A component draws these and decides nothing, so each sentence is tested by itself.
import type { FixFirstItem } from '#/contexts/ai/application/public-api'
import type {
  RatingGoalMode,
  RatingGoalStatus,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { worthUpToText } from './guest-voice-words'
import type { GuestVoiceWindow } from '#/contexts/ai/application/public-api'

/** The part of the goal's card the page needs: where the goal stands, nothing more. */
export type GuestVoiceGoalFacts = Readonly<{
  mode: RatingGoalMode
  /** The number the goal names (4.6): Google's own one-decimal rating. */
  target: number
  /** What Google shows now (4.4); null while it shows none. */
  shows: number | null
  status: RatingGoalStatus
}>

const STATUS_WORDS: Readonly<Record<RatingGoalStatus, string>> = {
  waiting_for_google: "it is waiting for Google's numbers",
  reached: 'it is reached',
  reviews_too_low: 'new reviews are averaging too low for it',
  getting_started: 'it has only just started',
  on_pace: 'it is on pace',
  below_pace: 'it is below pace',
  holding: 'it is holding',
  dropped_below: 'it has dropped below',
}

const oneDecimal = (value: number): string => value.toFixed(1)

/**
 * "Your Google rating goal is 4.6. Google shows 4.4 and it is below pace." A keep goal
 * says it is kept. Every figure is Google's own one-decimal number or the goal's target.
 */
export function goalHeadline(goal: GuestVoiceGoalFacts): string {
  const name =
    goal.mode === 'keep'
      ? `You are keeping ${oneDecimal(goal.target)} on Google.`
      : `Your Google rating goal is ${oneDecimal(goal.target)}.`
  const where =
    goal.shows === null
      ? `${capitalised(STATUS_WORDS[goal.status])}.`
      : `Google shows ${oneDecimal(goal.shows)} and ${STATUS_WORDS[goal.status]}.`
  return `${name} ${where}`
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The page's top problem against the goal: what it could be worth on the window's average,
 * said as the Fix first card says it. Null where the page has no problem to name.
 */
export function topProblemLine(
  top: FixFirstItem | undefined,
  window: GuestVoiceWindow,
): string | null {
  if (top === undefined) return null
  const worth = worthUpToText(top.statistics, window)
  return worth === null
    ? `${top.title} is the top problem on this page.`
    : `${top.title} is the top problem on this page, ${worth}.`
}
