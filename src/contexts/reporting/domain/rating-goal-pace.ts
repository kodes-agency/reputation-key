// Property Google rating goal — pace (pure).
//
// A climb goal carries a pace of new Google reviews in tenths of a review a
// week (rounds 3 and 4, 2026-10-16): 1 a week (10) to 50 a day (3500), so a
// pace a day or a month round-trips. The setup's paces are proactive and
// worked out from the proven pace (rating-goal-pace-chips.ts), no longer
// multiples of today's. The current pace is the reviews created in the last 28
// days, per week, which tracking judges a goal on. One release keeps a whole
// weekly mirror of the pace (migration 0060).

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
 * The whole weekly mirror of a pace in tenths: half up, at least one. The
 * database CHECK holds `pace_per_week` to the same integer division
 * (migration 0060), so the two never disagree.
 */
export const legacyPacePerWeek = (tenthsPerWeek: number): number =>
  Math.max(1, Math.floor((tenthsPerWeek + 5) / 10))

/** A pace in tenths of a review a week as an exact ratio of reviews a week. */
export const paceRatio = (tenthsPerWeek: number): Ratio => ratio(tenthsPerWeek, 10)
