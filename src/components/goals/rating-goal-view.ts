// What the Property Google rating goal says, worked out once for the simple
// card, the detail page and the history (ADR 0067). Google's own number leads;
// the exact average is drawn on the detail's chart; when a goal arrives is a
// duration from today (rating-goal-arrival-words.ts), never a date; "review"
// means a Google review and nothing else.
import type {
  GoogleNumbersView,
  RatingGoalCardView,
  RatingGoalChangeView,
  RatingGoalEndedReason,
  RatingGoalHistoryEntry,
  RatingGoalStatus,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type { StatusMap, StatusPresentation } from '#/components/ui/status-badge'
import { formatNumber, formatShortDate } from '#/lib/format'
import { paceChangeText, paceText } from './rating-goal-pace-words'

/** How a rating goal's status reads as a pill. */
export const RATING_GOAL_STATUS: StatusMap<RatingGoalStatus> = {
  waiting_for_google: { label: 'Waiting for Google', tone: 'neutral' },
  reached: { label: 'Reached', tone: 'positive' },
  reviews_too_low: { label: 'New reviews too low', tone: 'warn' },
  getting_started: { label: 'Getting started', tone: 'neutral' },
  on_pace: { label: 'On pace', tone: 'positive' },
  below_pace: { label: 'Below pace', tone: 'warn' },
  holding: { label: 'Holding', tone: 'positive' },
  dropped_below: { label: 'Dropped below', tone: 'warn' },
}

/**
 * A goal's status as its card and its page draw it: "New reviews too low"
 * names the target there ("New reviews too low for 4.0"), where the status is
 * the only thing said about it (round 2, R2-5). The Properties list prints the
 * target on the line above, so it keeps the plain label.
 */
export function ratingGoalStatusBadge(
  goal: Pick<RatingGoalCardView, 'status' | 'target'>,
): StatusPresentation {
  if (goal.status !== 'reviews_too_low') {
    // A status from a server newer than the page reads as "Unknown", as StatusBadge's map does.
    return Object.hasOwn(RATING_GOAL_STATUS, goal.status)
      ? RATING_GOAL_STATUS[goal.status]
      : { label: 'Unknown', tone: 'neutral' }
  }
  return {
    label: `${RATING_GOAL_STATUS.reviews_too_low.label} for ${ratingText(goal.target)}`,
    tone: RATING_GOAL_STATUS.reviews_too_low.tone,
  }
}

/**
 * What "New reviews too low" means, in the notice's own words (R2-10): the
 * reviews since the goal was set average at or below what the target needs.
 */
export const reviewsTooLowSentence = (target: number): string =>
  `Since you set the goal, new reviews average below what ${ratingText(target)} needs.`

/** Why the numbers are approximate: RepKey's copy of the reviews is short of Google's count. */
export const APPROXIMATE_NUMBERS =
  'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.'

/** "4.5": a rating to one decimal, as Google prints it. */
export const ratingText = (value: number): string =>
  formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "93 reviews", "1 review". */
export const reviewsText = (count: number): string =>
  `${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'}`

/** A target in tenths as text: 45 is "4.5". */
export const tenthsText = (tenths: number): string => ratingText(tenths / 10)

/**
 * What Google shows, as the headline prints it: Google's own last number, with
 * its date while it is stale ("as of Oct 12"), and a dash only when Google has
 * never sent one.
 */
export function googleShows(
  google: GoogleNumbersView | null,
  timezone: string,
  now: Date,
): Readonly<{ figure: string; asOf: string | null }> {
  if (google === null || google.shows === null) return { figure: '–', asOf: null }
  const day = google.current ? null : formatShortDate(google.asOf, timezone, now)
  return { figure: ratingText(google.shows), asOf: day === null ? null : `as of ${day}` }
}

/**
 * The average a goal's numbers assume: the plan's until a review arrived since
 * it was set, then the plan's mixed with them step by step, and theirs alone
 * while they are too low for the target (round 4, X3).
 */
export function assumedAverageWords(
  goal: Pick<RatingGoalCardView, 'qualityBasis' | 'quality'>,
): string {
  if (goal.qualityBasis === 'since_set') return 'at the new reviews’ average'
  if (goal.quality === null) return 'at the recent star mix'
  const plan = `at your plan’s ${ratingText(goal.quality)}★`
  if (goal.qualityBasis === 'planned') return plan
  if (goal.qualityBasis === 'blended') return `${plan} mixed with new reviews so far`
  return 'at the recent star mix'
}

/**
 * Why the goal waits for Google. The headline already dates numbers that are
 * not current ("as of Oct 12"), so the sentence names the day only when it
 * does not; never a clock time, which would have to name its zone.
 */
export function waitingSentence(
  google: GoogleNumbersView | null,
  timezone: string,
  now: Date,
): string {
  if (google === null) return 'Waiting for Google’s numbers.'
  const day = google.current ? formatShortDate(google.asOf, timezone, now) : null
  return day === null
    ? 'Waiting for Google’s latest numbers.'
    : `Waiting for Google’s latest numbers. These are from ${day}.`
}

const ENDED_REASON: Readonly<Record<RatingGoalEndedReason, string>> = {
  manager: 'ended by a manager',
  google_location_changed: 'Google location changed',
  property_archived: 'property archived',
}

/** Why a goal ended, as a sentence: "Ended: Google location changed". */
export const endedSentence = (reason: RatingGoalEndedReason | null): string => {
  const words = reason === null ? null : ENDED_REASON[reason]
  if (words === null) return 'Ended'
  return reason === 'manager' ? 'Ended by a manager' : `Ended: ${words}`
}

/** A goal reached, or ended by something other than a manager, as the Goals page tells it. */
export type RatingGoalOutcomeView = Readonly<{
  goalId: string
  state: 'reached' | 'ended'
  targetTenths: number
  target: number
  endedReason: RatingGoalEndedReason | null
  /** When it was reached or ended (ISO). */
  at: string
}>

/**
 * How long the Goals page keeps telling a goal was reached or ended. The
 * snapshot consumer usually reaches a goal before anyone looks, so the news
 * comes from History, not from the read that found it.
 */
export const OUTCOME_SHOWN_FOR_DAYS = 14
const OUTCOME_SHOWN_FOR_MS = OUTCOME_SHOWN_FOR_DAYS * 24 * 60 * 60 * 1000

/** The goal this card read found reached or ended; null for an active goal. */
export function outcomeFromCard(
  card: RatingGoalCardView,
  readAt: Date,
): RatingGoalOutcomeView | null {
  if (card.state === 'active') return null
  const { goalId, targetTenths, target, endedReason } = card
  return {
    goalId,
    state: card.state,
    targetTenths,
    target,
    endedReason,
    at: readAt.toISOString(),
  }
}

/**
 * The newest goal in History while it is news: reached, or ended because its
 * Google location changed or its Property was archived, in the last
 * `OUTCOME_SHOWN_FOR_DAYS`. A goal a manager ended is not news to tell.
 */
export function recentOutcome(
  history: readonly RatingGoalHistoryEntry[] | undefined,
  now: Date,
): RatingGoalOutcomeView | null {
  const latest = history?.[0]
  if (latest === undefined) return null
  if (latest.state === 'ended' && latest.endedReason === 'manager') return null
  const at = latest.state === 'reached' ? latest.reachedAt : latest.endedAt
  if (at === null || now.getTime() - Date.parse(at) > OUTCOME_SHOWN_FOR_MS) return null
  const { goalId, targetTenths, target, endedReason } = latest
  return { goalId, state: latest.state, targetTenths, target, endedReason, at }
}

const HISTORY_STATUS: Readonly<Record<'reached' | 'ended', StatusPresentation>> = {
  reached: { label: 'Reached', tone: 'positive' },
  ended: { label: 'Ended', tone: 'neutral' },
}

/** One reached or ended goal: what it aimed at, its pace, when, and why it ended. */
export function historyEntryView(
  entry: RatingGoalHistoryEntry,
  timezone: string,
  now: Date,
): Readonly<{ title: string; summary: string; status: StatusPresentation }> {
  const day = (at: string | null) =>
    at === null ? null : formatShortDate(at, timezone, now)
  const target = ratingText(entry.target)
  const reached = day(entry.reachedAt)
  const ended = day(entry.endedAt)
  const reason = entry.state === 'ended' ? entry.endedReason : null
  const parts = [
    entry.paceTenthsPerWeek === null ? null : paceText(entry.paceTenthsPerWeek),
    `set ${day(entry.setAt) ?? 'on an unknown day'}`,
    reached === null ? null : `reached ${reached}`,
    ended === null
      ? null
      : `ended ${ended}${reason === 'manager' ? ' by a manager' : ''}`,
    reason === null || reason === 'manager' ? null : ENDED_REASON[reason],
  ]
  return {
    title:
      entry.mode === 'keep' ? `Keep ${target} on Google` : `Reach ${target} on Google`,
    summary: parts.filter((part): part is string => part !== null).join(' · '),
    status: HISTORY_STATUS[entry.state],
  }
}

const MODE_WORD: Readonly<Record<string, string>> = { climb: 'reach', keep: 'keep' }

const tenthsValue = (value: string | null): string =>
  value === null ? 'none' : tenthsText(Number(value))

/** "New reviews average 4.5★ → 4.7★", "set to 4.5★" on a goal that had none. */
function qualityChangeText(oldValue: string | null, newValue: string | null): string {
  const stars = (value: string | null) =>
    value === null ? 'none' : `${tenthsText(Number(value))}★`
  return oldValue === null && newValue !== null
    ? `New reviews average set to ${stars(newValue)}`
    : `New reviews average ${stars(oldValue)} → ${stars(newValue)}`
}

/**
 * One change, old to new: "Target 4.4 → 4.5", "Pace 2 → 1.5 a day" (the log
 * keeps tenths of a review a week), "New reviews average 4.5★ → 4.7★".
 */
export function changeText(change: RatingGoalChangeView): string {
  const { oldValue, newValue } = change
  switch (change.field) {
    case 'target':
      return `Target ${tenthsValue(oldValue)} → ${tenthsValue(newValue)}`
    case 'pace':
      return paceChangeText(oldValue, newValue)
    case 'mode':
      return `Goal ${MODE_WORD[oldValue ?? ''] ?? 'none'} → ${MODE_WORD[newValue ?? ''] ?? 'none'}`
    case 'quality':
      return qualityChangeText(oldValue, newValue)
  }
}
