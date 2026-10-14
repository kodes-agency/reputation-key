// Property Google rating goal — which changes its managers are told (pure).
//
// Five notices, change-only (ADR 0067 decision 6, ADR 0046 amended
// 2026-10-14). An evaluation that only repeats what the goal already holds
// tells nobody anything:
//   reached                 Google shows the target (the only notice then,
//                           even when the same change is a tenth gained);
//   google_rating_changed   Google shows another tenth than it last showed;
//   entered_below_pace      a climb goal is below its pace, at most once in
//                           14 days;
//   entered_cant_reach      the recent mix no longer clears the threshold;
//   keep_dropped_below      a keep goal's tenth is no longer shown (in place of
//                           the tenth lost, which is the same change).
// A status is "entered" against the last status that was not waiting for
// Google, so a day without Google's numbers never repeats a notice. A status
// the goal has not known before (a new goal, a plan a manager just changed) is
// stored without a notice: notices report what Google and the reviews did,
// never a manager's own change. An evaluation that ends the goal tells nobody.
// The engine's status order already keeps Below pace out while a goal is
// waiting, getting started, reached or out of reach (rating-goal-status.ts).

import type { Ratio } from './rating-goal-numbers'
import type { PropertyRatingGoal, RatingGoalMode, RatingGoalStatus } from './rating-goal'
import type { PaceWindow } from './rating-goal-status'

/** A goal tells its managers it fell below pace at most once in this many days. */
export const BELOW_PACE_NOTICE_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
/** A pace window this long is "the last 4 weeks"; a shorter one runs from the set. */
const FULL_PACE_WINDOW_MS = 28 * DAY_MS

export type RatingGoalTransition =
  | 'reached'
  | 'google_rating_changed'
  | 'entered_below_pace'
  | 'entered_cant_reach'
  | 'keep_dropped_below'

export const RATING_GOAL_TRANSITIONS = [
  'reached',
  'google_rating_changed',
  'entered_below_pace',
  'entered_cant_reach',
  'keep_dropped_below',
] as const satisfies readonly RatingGoalTransition[]

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
      pacePerWeek: number
      /** New reviews a week in the pace window, in tenths, rounded down. */
      recentPaceTenths: number
      paceWindow: RatingGoalPaceWindowKind
    }>
  | Readonly<{
      transition: 'entered_cant_reach'
      targetTenths: number
      /** The recent mix in hundredths of a star, rounded down. */
      mixHundredths: number
    }>
  | Readonly<{
      transition: 'keep_dropped_below'
      targetTenths: number
      shownTenths: number
    }>

export type RatingGoalNoticeInput = Readonly<{
  goal: Pick<
    PropertyRatingGoal,
    'mode' | 'targetTenths' | 'pacePerWeek' | 'lastEvaluation'
  >
  evaluation: Readonly<{
    status: RatingGoalStatus
    /** The tenth Google showed; null when Google could not be read. */
    displayedTenths: number | null
    outcome: 'continues' | 'reached' | 'ended'
  }>
  /** The recent mix the status was worked out on; null when there is none. */
  mix: Ratio | null
  /** Reviews created in the status's pace window, when the status judged pace. */
  pace: Readonly<{ reviews: number; window: PaceWindow }> | null
  now: Date
}>

export type RatingGoalNoticeDecision = Readonly<{
  notices: readonly RatingGoalNotice[]
  /** The status a later evaluation compares with. */
  knownStatus: RatingGoalStatus | null
  belowPaceNoticedAt: Date | null
}>

/** True when the goal moved into `status` from another status it knew. */
const entered = (known: RatingGoalStatus | null, status: RatingGoalStatus): boolean =>
  known !== null && known !== status

const mayTellBelowPace = (noticedAt: Date | null, now: Date): boolean =>
  noticedAt === null ||
  now.getTime() - noticedAt.getTime() >= BELOW_PACE_NOTICE_DAYS * DAY_MS

/** Reviews a week over the window, in tenths, rounded down (never overstated). */
function recentPaceTenths(reviews: number, window: PaceWindow): number {
  const windowMs = window.end.getTime() - window.start.getTime()
  return windowMs <= 0 ? 0 : Math.floor((reviews * WEEK_MS * 10) / windowMs)
}

const paceWindowKind = (window: PaceWindow): RatingGoalPaceWindowKind =>
  window.end.getTime() - window.start.getTime() >= FULL_PACE_WINDOW_MS
    ? 'last_4_weeks'
    : 'since_set'

/** The mix in hundredths of a star, rounded down: never shown above the threshold. */
const hundredthsDown = (mix: Ratio): number => Number((mix.num * 100n) / mix.den)

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
  if (pace === null || goal.pacePerWeek === null) return null
  if (!mayTellBelowPace(goal.lastEvaluation.belowPaceNoticedAt, input.now)) return null
  return {
    transition: 'entered_below_pace',
    targetTenths: goal.targetTenths,
    pacePerWeek: goal.pacePerWeek,
    recentPaceTenths: recentPaceTenths(pace.reviews, pace.window),
    paceWindow: paceWindowKind(pace.window),
  }
}

/** The notice for a status the goal just entered, if it has one. */
function statusNotice(input: RatingGoalNoticeInput): RatingGoalNotice | null {
  const { goal, evaluation } = input
  if (!entered(goal.lastEvaluation.knownStatus, evaluation.status)) return null
  switch (evaluation.status) {
    case 'below_pace':
      return belowPaceNotice(input)
    case 'cant_reach_at_mix':
      return input.mix === null
        ? null
        : {
            transition: 'entered_cant_reach',
            targetTenths: goal.targetTenths,
            mixHundredths: hundredthsDown(input.mix),
          }
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
    }
  }
  const notices = noticesFor(input)
  const toldBelowPace = notices.some((n) => n.transition === 'entered_below_pace')
  return {
    notices,
    knownStatus:
      input.evaluation.status === 'waiting_for_google'
        ? previous.knownStatus
        : input.evaluation.status,
    belowPaceNoticedAt: toldBelowPace ? input.now : previous.belowPaceNoticedAt,
  }
}
