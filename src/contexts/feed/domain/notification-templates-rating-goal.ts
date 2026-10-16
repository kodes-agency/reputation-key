// Feed notification surface — copy for the Property Google rating goal notices.
//
// Five change-only notices (ADR 0067; ADR 0046, amended 2026-10-14 and
// 2026-10-15), split out of ./notification-templates.ts, which lists these
// renderers in its table.
// Named exports, as the account notices are: a spread of an imported record
// moved a whole module's copy into first paint's chunk. This module is a leaf;
// its copy type is restated structurally below.
//
// The figures are the Property's own: the tenth Google shows for it, the
// goal's target and pace, and the recent pace of new Google reviews. Never a
// review's rating, nor an average of ratings. "Review" means a Google review.
// Every figure is optional: a missing one shortens the sentence.
import type { NotificationPayload } from './notification-payload'

/** What a rating goal renderer returns; assignable to the templates' own copy type. */
type RatingGoalNoticeCopy = Readonly<{
  title: string
  body: string
  detail?: string
  actionLabel: string
  summary: string
}>

const VIEW_GOAL = 'View goal'

/** "4.5" from 45. */
const tenths = (value: number | undefined): string =>
  value === undefined ? '' : (value / 10).toFixed(1)

/** " for Riverside Hotel", or nothing when the name is unknown. */
const forProperty = (p: NotificationPayload): string =>
  p.propertyName === undefined ? '' : ` for ${p.propertyName}`

/** The facts line, led by the Property. */
const summaryOf = (p: NotificationPayload, fact: string): string =>
  p.propertyName === undefined ? fact : `${p.propertyName} · ${fact}`

/** "Google now shows 4.4 for Riverside Hotel", or null without the figure. */
const googleShows = (p: NotificationPayload): string | null =>
  p.ratingShownTenths === undefined
    ? null
    : `Google now shows ${tenths(p.ratingShownTenths)}${forProperty(p)}`

/**
 * Keep is offered only while Google shows 4.9 or 5.0, where no higher tenth can
 * be planned (round 2, R2-9; Reporting's `offerKeepFirst`, restated here as
 * Feed reads no Reporting module).
 */
const KEEP_OFFERED_FROM_TENTHS = 49

export const renderRatingGoalReached = (p: NotificationPayload): RatingGoalNoticeCopy => {
  const shows = googleShows(p)
  const keepOffered =
    p.ratingShownTenths !== undefined && p.ratingShownTenths >= KEEP_OFFERED_FROM_TENTHS
  return {
    title: shows === null ? 'Google rating goal reached' : `${shows}: goal reached`,
    body: keepOffered
      ? `Set your next goal, or keep ${tenths(p.ratingShownTenths)}.`
      : 'Set your next goal.',
    actionLabel: 'Set next goal',
    summary: summaryOf(p, 'Google rating goal reached'),
  }
}

/** "Your goal is 4.5." / "You're keeping 4.5.", or nothing without the target. */
const goalSentence = (p: NotificationPayload): string => {
  if (p.ratingTargetTenths === undefined) return ''
  const target = tenths(p.ratingTargetTenths)
  return p.ratingGoalMode === 'keep'
    ? `You’re keeping ${target}.`
    : `Your goal is ${target}.`
}

export const renderRatingGoalChanged = (p: NotificationPayload): RatingGoalNoticeCopy => {
  const shows = googleShows(p)
  const previous = p.ratingPreviousTenths
  const up =
    previous !== undefined &&
    p.ratingShownTenths !== undefined &&
    p.ratingShownTenths > previous
  const body = goalSentence(p)
  return {
    title:
      shows === null || previous === undefined
        ? `Google rating changed${forProperty(p)}`
        : `${shows}, ${up ? 'up' : 'down'} from ${tenths(previous)}`,
    body: body === '' ? 'Open the goal to see where it stands.' : body,
    detail: body,
    actionLabel: VIEW_GOAL,
    summary: summaryOf(p, 'Google rating changed'),
  }
}

/** "6" or "5.8": new reviews a week, from tenths. */
const perWeek = (paceTenths: number): string =>
  paceTenths % 10 === 0 ? String(paceTenths / 10) : (paceTenths / 10).toFixed(1)

/** "6 new reviews a week over the last 4 weeks", or "No new reviews since the goal was set". */
const recentPace = (paceTenths: number, p: NotificationPayload): string => {
  const window =
    p.ratingPaceWindow === 'since_set'
      ? 'since the goal was set'
      : 'over the last 4 weeks'
  if (paceTenths === 0) return `No new reviews ${window}`
  const noun = paceTenths === 10 ? 'review' : 'reviews'
  return `${perWeek(paceTenths)} new ${noun} a week ${window}`
}

/**
 * A plan reads per day from one review a day, per week below it (rounds 3 and
 * 4, R3-7). Restated from Reporting's `rating-goal-pace-words` (the components'
 * pace words), as Feed reads no Reporting module: 70 tenths a week is 1 a day.
 */
const ONE_A_DAY_TENTHS = 70

/** Tenths a week as a day, one decimal at most, half up: 105 is "1.5". */
const perDay = (paceTenths: number): string => {
  const dayTenths = Math.floor((2 * paceTenths + 7) / 14)
  return dayTenths % 10 === 0 ? String(dayTenths / 10) : (dayTenths / 10).toFixed(1)
}

/** "0.9 new reviews a day over the last 4 weeks; the plan is 2 a day." */
function belowPaceInTenths(
  recentTenths: number,
  planTenths: number,
  p: NotificationPayload,
) {
  const window =
    p.ratingPaceWindow === 'since_set'
      ? 'since the goal was set'
      : 'over the last 4 weeks'
  const daily = planTenths >= ONE_A_DAY_TENTHS
  const plan = daily ? `${perDay(planTenths)} a day` : `${perWeek(planTenths)} a week`
  if (recentTenths === 0) return `No new reviews ${window}; the plan is ${plan}.`
  const recent = daily ? perDay(recentTenths) : perWeek(recentTenths)
  const noun = recent === '1' ? 'review' : 'reviews'
  return `${recent} new ${noun} a ${daily ? 'day' : 'week'} ${window}; the plan is ${plan}.`
}

/** The Below pace sentence: per day for a plan in tenths a week, else the legacy weekly one. */
function belowPaceBody(p: NotificationPayload): string {
  if (p.ratingRecentPaceTenths === undefined) {
    return 'New reviews are coming in slower than the goal’s pace.'
  }
  if (p.ratingPaceTenthsPerWeek !== undefined) {
    return belowPaceInTenths(p.ratingRecentPaceTenths, p.ratingPaceTenthsPerWeek, p)
  }
  return p.ratingPacePerWeek === undefined
    ? 'New reviews are coming in slower than the goal’s pace.'
    : `${recentPace(p.ratingRecentPaceTenths, p)}; the goal’s pace is ${p.ratingPacePerWeek} a week.`
}

export const renderRatingGoalBelowPace = (
  p: NotificationPayload,
): RatingGoalNoticeCopy => {
  const body = belowPaceBody(p)
  return {
    title:
      p.propertyName === undefined
        ? 'Below the Google review pace'
        : `${p.propertyName} is below its Google review pace`,
    body,
    detail: body,
    actionLabel: VIEW_GOAL,
    summary: summaryOf(p, 'below the review pace'),
  }
}

/** "for 4.5", or "for the goal" without the target. */
const forTarget = (p: NotificationPayload): string =>
  p.ratingTargetTenths === undefined
    ? 'for the goal'
    : `for ${tenths(p.ratingTargetTenths)}`

/**
 * Ten or more Google reviews since the goal was set average at or below what
 * its target needs (round 2, 2026-10-15). It states no number of stars.
 */
export const renderRatingGoalTooLow = (p: NotificationPayload): RatingGoalNoticeCopy => {
  const needs = p.ratingTargetTenths === undefined ? 'it' : tenths(p.ratingTargetTenths)
  const body = `Since you set the goal they average below what ${needs} needs. Open the goal to see what helps.`
  return {
    title: `New Google reviews${forProperty(p)} are too low ${forTarget(p)}`,
    body,
    detail: body,
    actionLabel: VIEW_GOAL,
    summary: summaryOf(p, 'new reviews too low'),
  }
}

export const renderRatingGoalKeepDropped = (
  p: NotificationPayload,
): RatingGoalNoticeCopy => {
  const shows = googleShows(p)
  return {
    title:
      shows === null || p.ratingTargetTenths === undefined
        ? `Google rating dropped below the one you keep${forProperty(p)}`
        : `${shows}, below the ${tenths(p.ratingTargetTenths)} you’re keeping`,
    body: 'Open the goal to see what it takes to get back.',
    actionLabel: VIEW_GOAL,
    summary: summaryOf(p, 'below the rating you keep'),
  }
}
