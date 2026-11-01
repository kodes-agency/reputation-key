// Property Google rating goal — what the detail page still works out of a climb
// (pure): reviews in four weeks as a month, and what a goal was set with.
//
// The cone and the likely band that lived here went with the fan chart they drew
// (2026-11-01, ADR 0067): the page now draws a line to the goal, and the time it
// says is the card's own arrival.

import { roundHalfUpInt } from './rating-goal-numbers'
import type { RatingGoalChangeField } from './rating-goal'

/** Days in a month, in tenths (30.4), over the 28 days a count covers. */
const MONTH_TENTH_DAYS = 304
const TENTH_DAYS_IN_FOUR_WEEKS = 280

/** Reviews in four weeks as a whole number a month (30.4 days), half up. */
export const perMonthOf28Days = (count: number): number =>
  roundHalfUpInt(count * MONTH_TENTH_DAYS, TENTH_DAYS_IN_FOUR_WEEKS)

/** A change log row as the first-per-field read returns it. */
export type FirstChange = Readonly<{
  field: RatingGoalChangeField
  oldValue: string | null
}>

export type InitialPlan = Readonly<{
  targetTenths: number
  paceTenthsPerWeek: number | null
}>

/** A logged value as a whole number; null as "none" or anything unreadable. */
const loggedNumber = (value: string | null): number | null =>
  value === null || !Number.isInteger(Number(value)) ? null : Number(value)

/**
 * What the goal was set with (E31): each field's oldest change's old value,
 * else the value it has now (that field never changed).
 */
export function initialPlan(
  current: InitialPlan,
  firstPerField: readonly FirstChange[],
): InitialPlan {
  const first = (field: RatingGoalChangeField) =>
    firstPerField.find((change) => change.field === field)
  const target = first('target')
  const pace = first('pace')
  return {
    targetTenths:
      target === undefined
        ? current.targetTenths
        : (loggedNumber(target.oldValue) ?? current.targetTenths),
    paceTenthsPerWeek:
      pace === undefined ? current.paceTenthsPerWeek : loggedNumber(pace.oldValue),
  }
}
