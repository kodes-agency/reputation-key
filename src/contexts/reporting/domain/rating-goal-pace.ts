// Property Google rating goal — pace (pure).
//
// A goal is a target plus a weekly pace of new Google reviews. The current
// pace is the reviews created in the last 28 days, per week. Three paces are
// suggested from it: Steady (the current pace), Faster (about 1.5 times) and
// Push (about twice, the cap: Google flags surges). Rounding is half up and
// integer-exact, so 1.5 × 7 = 10.5 suggests 11 (the owner's worked example
// said "about 10" informally). A Property that gets fewer than one review a
// week is offered at least 1, 2 and 3.

import { ratio, type Ratio } from './rating-goal-numbers'

/** The current pace counts the reviews of this many days. */
export const PACE_WINDOW_DAYS = 28
const PACE_WINDOW_WEEKS = PACE_WINDOW_DAYS / 7

export const MIN_PACE_PER_WEEK = 1
export const MAX_PACE_PER_WEEK = 200

/** A goal's pace in tenths of a review a week: 1 a week to 50 a day. */
export const MIN_PACE_TENTHS_PER_WEEK = 10
export const MAX_PACE_TENTHS_PER_WEEK = 3500

/** Suggestions never fall below these, even at no reviews at all. */
const SUGGESTION_FLOORS = { steady: 1, faster: 2, push: 3 } as const

/** A custom pace above this multiple of the current pace earns a caution. */
const SURGE_CAUTION_MULTIPLE = 2

export type PaceSuggestions = Readonly<{ steady: number; faster: number; push: number }>

/** Steady, Faster or Push. */
export type PaceKey = keyof PaceSuggestions

/** Reviews created in the last 28 days, per week. */
export const currentPacePerWeek = (reviewsLast28Days: number): Ratio =>
  ratio(reviewsLast28Days, PACE_WINDOW_WEEKS)

/** round(numerator / denominator), half up, for non-negative integers. */
const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator))

/**
 * Steady = max(1, round(p)), Faster = max(2, round(1.5p)), Push =
 * max(3, round(2p)) with p = reviews in 28 days / 4. Each is at least one
 * above the one before, and Push never passes the largest pace a goal stores.
 */
export function paceSuggestions(reviewsLast28Days: number): PaceSuggestions {
  const count = reviewsLast28Days
  const steady = Math.min(
    Math.max(SUGGESTION_FLOORS.steady, roundHalfUp(count, 4)),
    MAX_PACE_PER_WEEK - 2,
  )
  const faster = Math.min(
    Math.max(SUGGESTION_FLOORS.faster, roundHalfUp(3 * count, 8), steady + 1),
    MAX_PACE_PER_WEEK - 1,
  )
  const push = Math.min(
    Math.max(SUGGESTION_FLOORS.push, roundHalfUp(count, 2), faster + 1),
    MAX_PACE_PER_WEEK,
  )
  return { steady, faster, push }
}

/** A weekly pace per month: round(w × 52 / 12), half up. */
export const perMonth = (perWeek: number): number => roundHalfUp(52 * perWeek, 12)

/** A weekly pace per day to one decimal: round(w / 7, 1), half up. */
export const perDay = (perWeek: number): number => roundHalfUp(10 * perWeek, 7) / 10

export const isValidPace = (perWeek: number): boolean =>
  Number.isInteger(perWeek) &&
  perWeek >= MIN_PACE_PER_WEEK &&
  perWeek <= MAX_PACE_PER_WEEK

/** True when a custom pace is above twice the current pace (at least 1 a week). */
export function surgeCaution(customPerWeek: number, reviewsLast28Days: number): boolean {
  // custom > 2 × max(count / 4, 1)  ⇔  4 × custom > 2 × max(count, 4)
  return (
    PACE_WINDOW_WEEKS * customPerWeek >
    SURGE_CAUTION_MULTIPLE * Math.max(reviewsLast28Days, PACE_WINDOW_WEEKS)
  )
}

export const isValidPaceTenths = (tenthsPerWeek: number): boolean =>
  Number.isInteger(tenthsPerWeek) &&
  tenthsPerWeek >= MIN_PACE_TENTHS_PER_WEEK &&
  tenthsPerWeek <= MAX_PACE_TENTHS_PER_WEEK

/**
 * The whole weekly mirror of a pace in tenths: half up, at least one. The
 * database CHECK holds `pace_per_week` to the same integer division
 * (migration 0060), so the two never disagree.
 */
export const legacyPacePerWeek = (tenthsPerWeek: number): number =>
  Math.max(1, Math.floor((tenthsPerWeek + 5) / 10))

/** A pace in tenths of a review a week as an exact ratio of reviews a week. */
export const paceRatio = (tenthsPerWeek: number): Ratio => ratio(tenthsPerWeek, 10)
