// What the Monday check-in says (round 5, PLAN-D D-3 §5.5, owner answer Q4,
// mock D4 with V10/V15/V19/V20): last week against the plan, the plan as it
// reads, and Keep, Raise and Ease with the pace each leaves. Plain words,
// sentence case, "review" is a Google review. The card read worked the
// numbers out; nothing here does maths beyond the difference it says.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { paceText, weeklyTarget } from './rating-goal-pace-words'
import { tenthsText } from './rating-goal-view'

/** One review a day, in tenths of a review a week: below it the plan reads per week. */
const ONE_A_DAY_TENTHS = 70

export type RecapChoice = Readonly<{ label: string; paceTenthsPerWeek: number }>

export type RecapWords = Readonly<{
  label: 'Last week'
  headline: string
  sub: string
  note: string
  keep: RecapChoice
  raise: RecapChoice | null
  ease: RecapChoice | null
}>

const reviewsText = (count: number): string =>
  `${formatNumber(count)} new Google ${count === 1 ? 'review' : 'reviews'}`

/** "1 more than planned", "2 fewer than planned", "as planned". */
function againstPlan(count: number, planned: number): string {
  const difference = count - planned
  if (difference === 0) return 'as planned'
  const side = difference > 0 ? 'more' : 'fewer'
  return `${formatNumber(Math.abs(difference))} ${side} than planned`
}

type Recap = NonNullable<RatingGoalCardView['recap']>

function headlineOf(recap: Recap): string {
  const planned = recap.plannedLastWeek
  if (recap.count === 0) {
    const plan = planned === null ? '' : ` The plan was ${formatNumber(planned)}.`
    return `No new Google reviews last week.${plan}`
  }
  const average =
    recap.averageTenths === null ? '' : ` at ${tenthsText(recap.averageTenths)}★`
  const counted = `${reviewsText(recap.count)}${average}`
  return planned === null
    ? `${counted} last week.`
    : `${counted}, ${againstPlan(recap.count, planned)}.`
}

/** "Your plan is 1 a day, about 7 a week." or, under one a day, "Your plan is 3 a week." */
function planOf(pace: number): string {
  const about =
    pace >= ONE_A_DAY_TENTHS ? `, about ${formatNumber(weeklyTarget(pace))} a week` : ''
  return `Your plan is ${paceText(pace)}${about}. Keep it for this week, or change it.`
}

const choice = (verb: string, pace: number | null): RecapChoice | null =>
  pace === null ? null : { label: `${verb} ${paceText(pace)}`, paceTenthsPerWeek: pace }

/** The check-in's words, or null while none is due. */
export function recapWords(card: RatingGoalCardView): RecapWords | null {
  const { recap, paceTenthsPerWeek: pace } = card
  if (recap === null || pace === null) return null
  return {
    label: 'Last week',
    headline: headlineOf(recap),
    sub: planOf(pace),
    note: 'Nothing changes unless you choose.',
    keep: { label: `Keep ${paceText(pace)}`, paceTenthsPerWeek: pace },
    raise: choice('Raise to', recap.raiseToTenths),
    ease: choice('Ease to', recap.easeToTenths),
  }
}

/** What a toast says once the check-in is answered. */
export const recapToasts = {
  kept: (pace: number): string => `Kept ${paceText(pace)} for this week.`,
  changed: (pace: number): string =>
    `Pace changed to ${paceText(pace)}. Getting started again for 2 weeks.`,
} as const
