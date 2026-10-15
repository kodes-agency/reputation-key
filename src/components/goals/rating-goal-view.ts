// What the Property Google rating goal says, worked out once for the simple
// card, the detail page and the history (ADR 0067). Google's own number leads;
// the exact average is progress ("4.38 of 4.45"); a forecast is a month range,
// never a date; "review" means a Google review and nothing else.
import type {
  GoogleNumbersView,
  RatingPaceView,
  RatingForecastView,
  RatingGoalCardView,
  RatingGoalChangeView,
  RatingGoalEndedReason,
  RatingGoalHistoryEntry,
  RatingGoalStatus,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type { StatusMap, StatusPresentation } from '#/components/ui/status-badge'
import { formatMonthKey, formatNumber, formatShortDate } from '#/lib/format'

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
 * The exact average against the threshold, to the hundredth. It is cut, never
 * rounded, so 4.449 reads "4.44 of 4.45" and never claims the line early.
 */
export function exactProgressText(exact: number | null, threshold: number): string {
  if (exact === null) return 'Exact average not known yet'
  const cut = Math.floor(exact * 100 + 1e-9) / 100
  const hundredths = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return `${formatNumber(cut, hundredths)} of ${formatNumber(threshold, hundredths)}`
}

/**
 * The exact average against the threshold, named for what it is: "Exact average
 * 4.38 of 4.45" from RepKey's complete copy of the reviews, or "About 4.30 of
 * 4.45" while that copy is short of Google's count and the figure is Google's
 * own rounded number (plan, Terms). The card's bar and the detail page say it
 * the same way.
 */
export function averageProgressText(
  view: Pick<RatingGoalCardView, 'exactAverage' | 'exactAverageSource' | 'threshold'>,
): string {
  const progress = exactProgressText(view.exactAverage, view.threshold)
  if (view.exactAverage === null) return progress
  return view.exactAverageSource === 'google'
    ? `About ${progress}`
    : `Exact average ${progress}`
}

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

type ForecastRange = Extract<RatingForecastView, { kind: 'range' }>

/** "Jul–Sep 2027", "Nov 2026 – Jan 2027", "Jul 2027", "Dec 2028 or later". */
export function forecastMonths({ fromMonth, toMonth }: ForecastRange): string {
  const from = formatMonthKey(fromMonth) ?? fromMonth
  if (toMonth === null) return `${from} or later`
  if (toMonth === fromMonth) return from
  const to = formatMonthKey(toMonth) ?? toMonth
  if (toMonth.slice(0, 4) !== fromMonth.slice(0, 4)) return `${from} – ${to}`
  return `${formatMonthKey(fromMonth, { year: false }) ?? fromMonth}–${to}`
}

/** A forecast as one sentence: when, or why no month can be given. */
export function forecastSentence(
  forecast: RatingForecastView,
  target: number,
  lead = 'Expected around',
): string {
  switch (forecast.kind) {
    case 'range':
      return `${lead} ${forecastMonths(forecast)}`
    case 'unreachable':
      return `No pace reaches ${ratingText(target)} at the recent star mix`
    case 'no_pace':
      return 'No new reviews in the last 4 weeks to forecast from'
    case 'beyond_horizon':
      return 'More than ten years away at this pace'
  }
}

/** "48 a month · 1.6 a day": what only the chosen pace also shows. */
export const perMonthAndDay = (pace: RatingPaceView): string =>
  `${formatNumber(pace.perMonth)} a month · ${formatNumber(pace.perDay)} a day`

/** "11 new reviews a week". */
export const newReviewsAWeek = (pace: number): string =>
  `${formatNumber(pace)} new ${pace === 1 ? 'review' : 'reviews'} a week`

/** The card's one pace line: the aim while the goal is new, then this week against it. */
export function cardPaceLine(card: RatingGoalCardView): string | null {
  if (card.mode === 'keep' || card.pacePerWeek === null) return null
  if (card.justSet) return `Aim for about ${newReviewsAWeek(card.pacePerWeek)}`
  return `This week: ${formatNumber(card.thisWeekCount)} of ${reviewsText(card.pacePerWeek)}`
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

/**
 * The card's one line about what comes next: the forecast, or the sentence
 * that stands in for it (waiting for Google, Google about to show the target,
 * no pace reaching it at the recent mix). None for a goal that keeps a number.
 */
export function cardOutlook(
  card: RatingGoalCardView,
  timezone: string,
  now: Date,
): string | null {
  if (card.status === 'waiting_for_google') {
    return waitingSentence(card.google, timezone, now)
  }
  if (card.mode === 'keep') return null
  if (card.googleShowsSoon) return `Google should show ${ratingText(card.target)} soon`
  if (card.status === 'reviews_too_low') return reviewsTooLowSentence(card.target)
  return card.forecast === null ? null : forecastSentence(card.forecast, card.target)
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
    entry.pacePerWeek === null ? null : `${formatNumber(entry.pacePerWeek)} a week`,
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

const paceValue = (value: string | null): string =>
  value === null ? 'none' : `${formatNumber(Number(value))} a week`

/** One change, old to new: "Target 4.4 → 4.5", "Pace 14 → 11 a week". */
export function changeText(change: RatingGoalChangeView): string {
  const { oldValue, newValue } = change
  switch (change.field) {
    case 'target':
      return `Target ${tenthsValue(oldValue)} → ${tenthsValue(newValue)}`
    case 'pace':
      return oldValue !== null && newValue !== null
        ? `Pace ${formatNumber(Number(oldValue))} → ${paceValue(newValue)}`
        : `Pace ${paceValue(oldValue)} → ${paceValue(newValue)}`
    case 'mode':
      return `Goal ${MODE_WORD[oldValue ?? ''] ?? 'none'} → ${MODE_WORD[newValue ?? ''] ?? 'none'}`
    case 'quality':
      return `New reviews ${tenthsValue(oldValue)} → ${tenthsValue(newValue)}`
  }
}
