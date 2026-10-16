// Property Google rating goal — what the setup works its plan out from (types only).
//
// Rounds 3 and 4 (2026-10-16): the setup opens already answered, worked out on
// the page from these exact inputs with no server call. The server runs no
// planning maths for it (PLAN-R4 D18). Averages are integer fractions; no
// review and no per-review value is here, only Property-level totals.

import type { RatingExactAverageSource } from './rating-goal.types'

/** An exact fraction `num / den`. */
export type RatingFraction = Readonly<{ num: number; den: number }>

export type RatingGoalSetupInputs = Readonly<{
  /** Google's review count. */
  reviewCount: number
  /** The tenth Google shows. */
  displayedTenths: number
  exact: RatingFraction
  exactSource: RatingExactAverageSource
  /** The best Property-local calendar month of the last twelve with ten reviews. */
  bestMonth: Readonly<{
    year: number
    month: number
    average: RatingFraction
    reviewCount: number
  }> | null
  /** The best calendar year with ten reviews. */
  bestYear: Readonly<{
    year: number
    average: RatingFraction
    reviewCount: number
  }> | null
  /** Reviews created in the last 90 days. */
  reviewsLast90Days: number
  /** The most reviews on 30 consecutive Property-local dates of the last 365. */
  busiest30Days: number
  timezone: string
  /** The instant the inputs were read at (ISO). */
  asOf: string
}>
