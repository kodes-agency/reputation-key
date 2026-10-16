// What the Google rating goal card says about the climb (round 5, PLAN-D D-1,
// the D2/D4 mocks): the ladder of numbers from where the goal started, the new
// reviews to the next number Google can show, one empty square for each of
// them, this week against the plan and the first step taken. Plain words,
// sentence case; "review" is a Google review. While the exact average is
// Google's own rounded figure every count is "about" and no square is drawn,
// because a square promises a count it cannot know (E7).
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { actualPaceText, newReviewsAim, weeklyTarget } from './rating-goal-pace-words'
import { tenthsText } from './rating-goal-view'

/**
 * The headline's unit (Q1, owner 2026-10-16: "new reviews"): the count is of
 * reviews at the plan's average, not of five-star ones.
 */
const REVIEW_UNIT = { one: 'new review', many: 'new reviews' } as const

/** Squares are drawn for this many reviews at most; past it the number stands alone. */
const MAX_SLOTS = 30

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

type Card = RatingGoalCardView

/** Counts are "about" while the exact average is Google's own rounded figure. */
const isAbout = (card: Pick<Card, 'exactAverageSource'>): boolean =>
  card.exactAverageSource === 'google'

/** "18 new reviews", "about 1 new review". */
export function reviewCountText(count: number, about: boolean): string {
  const unit = count === 1 ? REVIEW_UNIT.one : REVIEW_UNIT.many
  return `${about ? 'about ' : ''}${formatNumber(count)} ${unit}`
}

/** The headline as its parts: the figure, its words, and the number it counts to. */
export type Headline =
  | Readonly<{ kind: 'count'; count: string; words: string; target: string }>
  | Readonly<{ kind: 'soon'; text: string }>

/**
 * "18 new reviews to 4.1" (the next number, E5), or "Google should show 4.1
 * soon" once the reviews have earned the goal. Null without a number to count to.
 */
export function headlineOf(card: Card): Headline | null {
  if (card.googleShowsSoon) {
    return {
      kind: 'soon',
      text: `Google should show ${tenthsText(card.targetTenths)} soon`,
    }
  }
  const next = card.next
  if (next === null) return null
  const unit = next.reviewsNeeded === 1 ? REVIEW_UNIT.one : REVIEW_UNIT.many
  return {
    kind: 'count',
    count: `${isAbout(card) ? 'about ' : ''}${formatNumber(next.reviewsNeeded)}`,
    words: `${unit} to`,
    target: tenthsText(next.targetTenths),
  }
}

/** The headline as one sentence, as a reader hears it. */
export function headlineText(card: Card): string | null {
  const headline = headlineOf(card)
  if (headline === null) return null
  return headline.kind === 'soon'
    ? headline.text
    : `${headline.count} ${headline.words} ${headline.target}`
}

/** "Google should show 4.4 soon": a tenth on the way that the cache already clears. */
export const soonText = (
  card: Pick<Card, 'earnedTenths' | 'googleShowsSoon'>,
): string | null =>
  card.earnedTenths === null || card.googleShowsSoon
    ? null
    : `Google should show ${tenthsText(card.earnedTenths)} soon`

/** "212 new reviews to your goal, 4.5.": said only when the headline counts to a nearer number. */
export function goalLineText(card: Card): string | null {
  if (card.next === null || card.next.targetTenths === card.targetTenths) return null
  if (card.stillNeeded === null) return null
  return `${reviewCountText(card.stillNeeded, isAbout(card))} to your goal, ${tenthsText(card.targetTenths)}.`
}

/** One empty square per review the headline counts, from 1 to 30, only from RepKey's full copy. */
export function slotCount(card: Card): number {
  const count = card.next?.reviewsNeeded ?? 0
  if (card.googleShowsSoon || isAbout(card) || count < 1 || count > MAX_SLOTS) return 0
  return count
}

/** "18 empty squares, one for each new review still needed". */
export const slotsLabel = (count: number): string =>
  count === 1
    ? `1 empty square for the ${REVIEW_UNIT.one} still needed`
    : `${formatNumber(count)} empty squares, one for each ${REVIEW_UNIT.one} still needed`

export type RungTag = 'start' | 'today' | 'soon' | 'next' | 'goal' | 'possible'
export type Rung = Readonly<{ tenths: number; tag: RungTag }>

/** The ladder shows five numbers at most: where the goal started goes first. */
const MAX_RUNGS = 5

const tenthsOf = (rating: number): number => Math.round(rating * 10)

/**
 * The numbers of the climb, lowest first (E6): where it started (while Google
 * shows more now), today, a tenth Google should show soon, the next number when
 * it is not the goal, the goal, and the number above it when it is possible.
 */
export function rungsOf(card: Card): readonly Rung[] {
  const shows = card.google?.shows
  if (shows === null || shows === undefined) return []
  const today = tenthsOf(shows)
  const start = tenthsOf(card.baseline.googleShows)
  const next = card.next?.targetTenths ?? null
  const candidates: (Rung | null)[] = [
    start < today ? { tenths: start, tag: 'start' } : null,
    { tenths: today, tag: 'today' },
    card.earnedTenths === null || card.googleShowsSoon
      ? null
      : { tenths: card.earnedTenths, tag: 'soon' },
    next === null || next === card.targetTenths ? null : { tenths: next, tag: 'next' },
    card.targetTenths > today ? { tenths: card.targetTenths, tag: 'goal' } : null,
    card.nextUp === null ? null : { tenths: card.nextUp.targetTenths, tag: 'possible' },
  ]
  const rungs = candidates.filter((rung): rung is Rung => rung !== null)
  return rungs.length > MAX_RUNGS ? rungs.filter((rung) => rung.tag !== 'start') : rungs
}

const RUNG_SENTENCE: Readonly<Record<RungTag, (tenths: string) => string>> = {
  start: (tenths) => `Started at ${tenths}.`,
  today: (tenths) => `Google shows ${tenths} now.`,
  soon: (tenths) => `Google should show ${tenths} soon.`,
  next: (tenths) => `Next is ${tenths}.`,
  goal: (tenths) => `Your goal is ${tenths}.`,
  possible: (tenths) => `${tenths} is possible after that.`,
}

/** The ladder as a reader hears it: "Started at 3.9. Google shows 4.0 now. Your goal is 4.1." */
export const ladderLabel = (rungs: readonly Rung[]): string =>
  rungs.map((rung) => RUNG_SENTENCE[rung.tag](tenthsText(rung.tenths))).join(' ')

export type ThisWeekView =
  | Readonly<{ kind: 'aim'; text: string }>
  | Readonly<{
      kind: 'week'
      count: number
      target: number
      value: string
      valueText: string
      foot: string
    }>

/** "It’s Tuesday" from the server's day of the Property week. */
const weekdayName = (weekday: number): string => WEEKDAYS[weekday - 1] ?? 'Today'

/**
 * This week against the plan (R3-7: counted per week, "2 of 7"), with the day
 * and, once the goal works at its actual pace, the last four weeks; while the
 * goal is new, the aim per day instead. Null for a goal with no pace.
 */
export function thisWeekOf(card: Card): ThisWeekView | null {
  const pace = card.paceTenthsPerWeek
  if (pace === null) return null
  if (card.justSet) return { kind: 'aim', text: `Aim for ${newReviewsAim(pace)}` }
  const target = weeklyTarget(pace)
  const count = card.thisWeekCount
  const day = `It’s ${weekdayName(card.weekday)}`
  return {
    kind: 'week',
    count,
    target,
    value: `${formatNumber(count)} of ${formatNumber(target)}`,
    valueText: `${formatNumber(count)} of ${formatNumber(target)} ${REVIEW_UNIT.many} this week`,
    foot:
      card.forecastBasis === 'actual_pace'
        ? `${day} · ${actualPaceText(card.lastFourWeeksPerWeek, pace)} over the last 4 weeks`
        : day,
  }
}

/** "Google shows 4.0 now, up from 3.9 when you started.": the first step, once taken. */
export function firstStepText(card: Card): string | null {
  const shows = card.google?.shows
  if (shows === null || shows === undefined) return null
  if (tenthsOf(shows) <= tenthsOf(card.baseline.googleShows)) return null
  return `Google shows ${tenthsText(tenthsOf(shows))} now, up from ${tenthsText(tenthsOf(card.baseline.googleShows))} when you started.`
}
