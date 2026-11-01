// What the Google rating goal card says about the climb: the new reviews to the
// next number Google can show, and this week against the plan. Plain words,
// sentence case; "review" is a Google review. While the exact average is Google's
// own rounded figure every count is "about".
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { actualPaceText, newReviewsAim, weeklyTarget } from './rating-goal-pace-words'
import { tenthsText } from './rating-goal-view'

/**
 * The headline's unit (Q1, owner 2026-10-16: "new reviews"): the count is of
 * reviews at the plan's average, not of five-star ones.
 */
const REVIEW_UNIT = { one: 'new review', many: 'new reviews' } as const

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

/** "About" opens a line in sentence case. */
const aboutPrefix = (about: boolean): string => (about ? 'About ' : '')

/** "18 new reviews", "About 1 new review": the count that opens a line. */
export function reviewCountText(count: number, about: boolean): string {
  const unit = count === 1 ? REVIEW_UNIT.one : REVIEW_UNIT.many
  return `${aboutPrefix(about)}${formatNumber(count)} ${unit}`
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
    count: `${aboutPrefix(isAbout(card))}${formatNumber(next.reviewsNeeded)}`,
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
export const weekdayName = (weekday: number): string => WEEKDAYS[weekday - 1] ?? 'Today'

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
