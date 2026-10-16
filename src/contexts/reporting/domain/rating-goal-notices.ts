// Property Google rating goal — which changes its managers are told (pure).
//
// Five notices, change-only (ADR 0067 decision 6, ADR 0046 amended
// 2026-10-14 and 2026-10-15). An evaluation that only repeats what the goal
// already holds tells nobody anything:
//   reached                 Google shows the target (the only notice then,
//                           even when the same change is a tenth gained);
//   google_rating_changed   Google shows another tenth than it last showed;
//   entered_below_pace      a climb goal is below its pace, at most once in
//                           14 days;
//   entered_reviews_too_low ten or more reviews since the goal was set
//                           average at or below the target's threshold, at
//                           most once in 14 days, and with no star figure
//                           (round 2, 2026-10-15: it replaced "can't reach at
//                           the recent mix"; no notice for merely trailing the
//                           plan's quality);
//   keep_dropped_below      a keep goal's tenth is no longer shown (in place of
//                           the tenth lost, which is the same change).
// A status is "entered" against the last status that was not waiting for
// Google, so a day without Google's numbers never repeats a notice. A status
// the goal has not known before (a new goal, a plan a manager just changed) is
// stored without a notice: notices report what Google and the reviews did,
// never a manager's own change. An evaluation that ends the goal tells nobody.
// The engine's status order already keeps Below pace out while a goal is
// waiting, getting started, reached or too low (rating-goal-status.ts).

import type { PropertyRatingGoal, RatingGoalMode, RatingGoalStatus } from './rating-goal'
import type { PaceWindow } from './rating-goal-status'
import { legacyPacePerWeek } from './rating-goal-pace'

/** A goal tells its managers it fell below pace at most once in this many days. */
export const BELOW_PACE_NOTICE_DAYS = 14
/** A goal tells its managers new reviews are too low at most once in this many days. */
export const TOO_LOW_NOTICE_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
/** A pace window this long is "the last 4 weeks"; a shorter one runs from the set. */
const FULL_PACE_WINDOW_MS = 28 * DAY_MS

export type RatingGoalTransition =
  | 'reached'
  | 'google_rating_changed'
  | 'entered_below_pace'
  | 'entered_reviews_too_low'
  | 'keep_dropped_below'

/** Over which days a below-pace notice measured the reviews. */
export type RatingGoalPaceWindowKind = 'last_4_weeks' | 'since_set'

/** One notice, with the Property-level figures its copy states. */
export type RatingGoalNotice =
  | Readonly<{ transition: 'reached'; targetTenths: number; shownTenths: number }>
  | Readonly<{
      transition: 'google_rating_changed'
      mode: RatingGoalMode
      targetTenths: number
      shownTenths: number
      previousTenths: number
    }>
  | Readonly<{
      transition: 'entered_below_pace'
      targetTenths: number
      /** The goal's pace in tenths of a review a week. */
      paceTenthsPerWeek: number
      /** Its whole weekly mirror, for readers from before tenths (one release). */
      pacePerWeek: number
      /** New reviews a week in the pace window, in tenths, rounded down. */
      recentPaceTenths: number
      paceWindow: RatingGoalPaceWindowKind
    }>
  | Readonly<{ transition: 'entered_reviews_too_low'; targetTenths: number }>
  | Readonly<{
      transition: 'keep_dropped_below'
      targetTenths: number
      shownTenths: number
    }>

export type RatingGoalNoticeInput = Readonly<{
  goal: Pick<
    PropertyRatingGoal,
    'mode' | 'targetTenths' | 'paceTenthsPerWeek' | 'lastEvaluation'
  >
  evaluation: Readonly<{
    status: RatingGoalStatus
    /** The tenth Google showed; null when Google could not be read. */
    displayedTenths: number | null
    outcome: 'continues' | 'reached' | 'ended'
  }>
  /** Reviews created in the status's pace window, when the status judged pace. */
  pace: Readonly<{ reviews: number; window: PaceWindow }> | null
  now: Date
}>

export type RatingGoalNoticeDecision = Readonly<{
  notices: readonly RatingGoalNotice[]
  /** The status a later evaluation compares with. */
  knownStatus: RatingGoalStatus | null
  belowPaceNoticedAt: Date | null
  tooLowNoticedAt: Date | null
}>

/** True when the goal moved into `status` from another status it knew. */
const entered = (known: RatingGoalStatus | null, status: RatingGoalStatus): boolean =>
  known !== null && known !== status

/** True when the managers were never told, or not within the last `days` days. */
const mayTell = (noticedAt: Date | null, now: Date, days: number): boolean =>
  noticedAt === null || now.getTime() - noticedAt.getTime() >= days * DAY_MS

/** Reviews a week over the window, in tenths, rounded down (never overstated). */
function recentPaceTenths(reviews: number, window: PaceWindow): number {
  const windowMs = window.end.getTime() - window.start.getTime()
  return windowMs <= 0 ? 0 : Math.floor((reviews * WEEK_MS * 10) / windowMs)
}

const paceWindowKind = (window: PaceWindow): RatingGoalPaceWindowKind =>
  window.end.getTime() - window.start.getTime() >= FULL_PACE_WINDOW_MS
    ? 'last_4_weeks'
    : 'since_set'

function tenthNotice(input: RatingGoalNoticeInput): RatingGoalNotice | null {
  const previous = input.goal.lastEvaluation.displayedTenths
  const shown = input.evaluation.displayedTenths
  if (previous === null || shown === null || previous === shown) return null
  return {
    transition: 'google_rating_changed',
    mode: input.goal.mode,
    targetTenths: input.goal.targetTenths,
    shownTenths: shown,
    previousTenths: previous,
  }
}

function belowPaceNotice(input: RatingGoalNoticeInput): RatingGoalNotice | null {
  const { goal, pace } = input
  if (pace === null || goal.paceTenthsPerWeek === null) return null
  if (
    !mayTell(goal.lastEvaluation.belowPaceNoticedAt, input.now, BELOW_PACE_NOTICE_DAYS)
  ) {
    return null
  }
  return {
    transition: 'entered_below_pace',
    targetTenths: goal.targetTenths,
    paceTenthsPerWeek: goal.paceTenthsPerWeek,
    pacePerWeek: legacyPacePerWeek(goal.paceTenthsPerWeek),
    recentPaceTenths: recentPaceTenths(pace.reviews, pace.window),
    paceWindow: paceWindowKind(pace.window),
  }
}

function tooLowNotice(input: RatingGoalNoticeInput): RatingGoalNotice | null {
  const { goal } = input
  if (!mayTell(goal.lastEvaluation.tooLowNoticedAt, input.now, TOO_LOW_NOTICE_DAYS)) {
    return null
  }
  return { transition: 'entered_reviews_too_low', targetTenths: goal.targetTenths }
}

/** The notice for a status the goal just entered, if it has one. */
function statusNotice(input: RatingGoalNoticeInput): RatingGoalNotice | null {
  const { goal, evaluation } = input
  if (!entered(goal.lastEvaluation.knownStatus, evaluation.status)) return null
  switch (evaluation.status) {
    case 'below_pace':
      return belowPaceNotice(input)
    case 'reviews_too_low':
      return tooLowNotice(input)
    case 'dropped_below':
      return evaluation.displayedTenths === null
        ? null
        : {
            transition: 'keep_dropped_below',
            targetTenths: goal.targetTenths,
            shownTenths: evaluation.displayedTenths,
          }
    default:
      return null
  }
}

/** The notices one evaluation sends, ordered as the change happened. */
function continuingNotices(input: RatingGoalNoticeInput): readonly RatingGoalNotice[] {
  const status = statusNotice(input)
  // A keep goal dropping below is the tenth lost: one notice, not two.
  const tenth = status?.transition === 'keep_dropped_below' ? null : tenthNotice(input)
  return [tenth, status].filter((notice): notice is RatingGoalNotice => notice !== null)
}

function noticesFor(input: RatingGoalNoticeInput): readonly RatingGoalNotice[] {
  const { goal, evaluation } = input
  switch (evaluation.outcome) {
    case 'ended':
      return []
    case 'reached':
      return [
        {
          transition: 'reached',
          targetTenths: goal.targetTenths,
          shownTenths: evaluation.displayedTenths ?? goal.targetTenths,
        },
      ]
    case 'continues':
      return continuingNotices(input)
  }
}

/** What an evaluation tells the goal's managers, and what it stores to compare with next. */
export function decideRatingGoalNotices(
  input: RatingGoalNoticeInput,
): RatingGoalNoticeDecision {
  const previous = input.goal.lastEvaluation
  if (input.evaluation.outcome === 'ended') {
    return {
      notices: [],
      knownStatus: previous.knownStatus,
      belowPaceNoticedAt: previous.belowPaceNoticedAt,
      tooLowNoticedAt: previous.tooLowNoticedAt,
    }
  }
  const notices = noticesFor(input)
  const toldBelowPace = notices.some((n) => n.transition === 'entered_below_pace')
  const toldTooLow = notices.some((n) => n.transition === 'entered_reviews_too_low')
  return {
    notices,
    knownStatus:
      input.evaluation.status === 'waiting_for_google'
        ? previous.knownStatus
        : input.evaluation.status,
    belowPaceNoticedAt: toldBelowPace ? input.now : previous.belowPaceNoticedAt,
    tooLowNoticedAt: toldTooLow ? input.now : previous.tooLowNoticedAt,
  }
}
