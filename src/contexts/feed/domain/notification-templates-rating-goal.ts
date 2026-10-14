// Feed notification surface — copy for the Property Google rating goal notices.
//
// Five change-only notices (ADR 0067; ADR 0046, amended 2026-10-14), split out
// of ./notification-templates.ts, which lists these renderers in its table.
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

export const renderRatingGoalReached = (p: NotificationPayload): RatingGoalNoticeCopy => {
  const shows = googleShows(p)
  return {
    title: shows === null ? 'Google rating goal reached' : `${shows}: goal reached`,
    body:
      shows === null
        ? 'Set your next goal.'
        : `Set your next goal, or keep ${tenths(p.ratingShownTenths)}.`,
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

export const renderRatingGoalBelowPace = (
  p: NotificationPayload,
): RatingGoalNoticeCopy => {
  const body =
    p.ratingRecentPaceTenths === undefined || p.ratingPacePerWeek === undefined
      ? 'New reviews are coming in slower than the goal’s pace.'
      : `${recentPace(p.ratingRecentPaceTenths, p)}; the goal’s pace is ${p.ratingPacePerWeek} a week.`
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

/** "New reviews lately average below what 4.5 needs", without a number of stars. */
const cantReachBody = (p: NotificationPayload): string => {
  const needs =
    p.ratingTargetTenths === undefined ? 'the goal' : tenths(p.ratingTargetTenths)
  return `New reviews lately average below what ${needs} needs. Open the goal to see what it takes.`
}

export const renderRatingGoalCantReach = (
  p: NotificationPayload,
): RatingGoalNoticeCopy => {
  const body = cantReachBody(p)
  return {
    title: `${p.propertyName === undefined ? 'Your' : `${p.propertyName}’s`} Google goal can’t be reached at the recent mix`,
    body,
    detail: body,
    actionLabel: VIEW_GOAL,
    summary: summaryOf(p, 'out of reach at the recent mix'),
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
