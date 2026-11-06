// Climb pace is tenths of a review per week, from 10 (1/week) to 3500 (50/day).
// Tracking uses the last 28 days' reviews per week. Retain the whole-weekly mirror
// for stored/rolling-deploy compatibility (migration 0060).

import { ratio, type Ratio } from './rating-goal-numbers'

/** The current pace counts the reviews of this many days. */
export const PACE_WINDOW_DAYS = 28
const PACE_WINDOW_WEEKS = PACE_WINDOW_DAYS / 7

/** A goal's pace in tenths of a review a week: 1 a week to 50 a day. */
export const MIN_PACE_TENTHS_PER_WEEK = 10
export const MAX_PACE_TENTHS_PER_WEEK = 3500

/** Reviews created in the last 28 days, per week. */
export const currentPacePerWeek = (reviewsLast28Days: number): Ratio =>
  ratio(reviewsLast28Days, PACE_WINDOW_WEEKS)

export const isValidPaceTenths = (tenthsPerWeek: number): boolean =>
  Number.isInteger(tenthsPerWeek) &&
  tenthsPerWeek >= MIN_PACE_TENTHS_PER_WEEK &&
  tenthsPerWeek <= MAX_PACE_TENTHS_PER_WEEK

/**
 * The whole reviews a week a pace is counted against ("This week: 9 of 14",
 * last week's check-in): half up, at least one.
 */
export const weeklyPlanCount = (tenthsPerWeek: number): number =>
  Math.max(1, Math.floor((tenthsPerWeek + 5) / 10))

/**
 * The whole weekly mirror of a pace in tenths: the same count. The database
 * CHECK holds `pace_per_week` to the same integer division (migration 0060),
 * so the two never disagree.
 */
export const legacyPacePerWeek = (tenthsPerWeek: number): number =>
  weeklyPlanCount(tenthsPerWeek)

/** A pace in tenths of a review a week as an exact ratio of reviews a week. */
export const paceRatio = (tenthsPerWeek: number): Ratio => ratio(tenthsPerWeek, 10)
