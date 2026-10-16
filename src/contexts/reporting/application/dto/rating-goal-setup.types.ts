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

/** What the manager chose on the setup screen; null is "as recommended". */
export type RatingGoalSetupChoices = Readonly<{
  pace:
    | Readonly<{ kind: 'chip'; index: number }>
    | Readonly<{ kind: 'own'; tenthsPerWeek: number }>
    | null
  /** A typed average, in tenths. */
  ownAverageTenths: number | null
  /** Change plan: the plan's stored average when it differs from today's automatic one (D30). */
  keptAverageTenths: number | null
  /** A goal moved off the recommendation with − / +, in tenths. */
  pinnedTargetTenths: number | null
}>

export type RatingPaceChipView = Readonly<{
  kind: 'a_few_a_week' | 'busiest_month' | 'nice'
  tenthsPerWeek: number
}>

/**
 * Where the planned average comes from. `needs_own`: the automatic average
 * reaches no goal (a shown 4.7 or 4.8, or a 4.6 that has earned 4.7), so the
 * plan starts at the lowest average a manager may type, until they type one.
 */
export type RatingAverageSource =
  'best_month' | 'best_year' | 'halfway' | 'own' | 'earlier' | 'needs_own'

export type RatingAverageEvidenceView =
  | Readonly<{ kind: 'best_month'; year: number; month: number; tenths: number }>
  | Readonly<{ kind: 'best_year'; year: number; tenths: number }>

export type RatingSetupAverageView = Readonly<{
  tenths: number
  /** Today's automatic average, which "Back to automatic" returns to. */
  automaticTenths: number
  source: RatingAverageSource
  evidence: RatingAverageEvidenceView | null
  /** The lowest average a manager may type: two tenths above the shown number. */
  ownMinTenths: number
  /** A typed or kept average had to move into range. */
  clamped: boolean
  /** The automatic average reaches no goal, so only a typed one plans (4.7 and 4.8). */
  ownOnly: boolean
}>

export type RatingSetupPaceView = Readonly<{
  tenthsPerWeek: number
  chips: readonly RatingPaceChipView[]
  recommendedIndex: number
  /** The chip chosen; null for the manager's own pace. */
  chosenIndex: number | null
  busiest30: number
  /** The proven pace in tenths a day ("about 1.5 a day"). */
  provenDayTenths: number
  /** Reviews of the last 90 days as a nice number a month. */
  nowPerMonth: number
  /** An own pace or a chip index had to move into range. */
  clamped: boolean
}>

export type RatingSetupGoalView = Readonly<{
  shownTenths: number
  /** The highest tenth the cache already clears; the shown one unless Google lags (D28). */
  earnedTenths: number
  minTenths: number
  maxTenths: number
  targetTenths: number
  recommendedTenths: number
  /** False when no goal is within six months at 0.1★ below plan: the next one is suggested. */
  recommendedIsSafe: boolean
  /** Null while the goal follows the recommendation. */
  pinnedTenths: number | null
  /** The pinned goal needs more than this average reaches, so the highest is shown. */
  pinnedAboveMax: boolean
}>

/** The setup screen, worked out on the page from the inputs and the choices. */
export type RatingGoalSetupPlanView =
  /** Google shows 4.9 or 5.0: there is nothing higher to plan. */
  | Readonly<{ kind: 'keep_only' }>
  /** The cache already clears every tenth up to 4.9 while Google lags (D28). */
  | Readonly<{ kind: 'catching_up'; earnedTenths: number }>
  | Readonly<{
      kind: 'plan'
      average: RatingSetupAverageView
      pace: RatingSetupPaceView
      goal: RatingSetupGoalView
      /** Always more than none (D28). */
      reviewsNeeded: number
      days: RatingFraction
      likely: Readonly<{ fast: RatingFraction; slow: RatingFraction | null }>
      overSixMonths: boolean
      /** The goal above the recommendation, when the average reaches it. */
      nextUp: Readonly<{
        targetTenths: number
        reviewsNeeded: number
        days: RatingFraction
      }> | null
      /** The chip that gets there within six months (or the fastest), when over six months. */
      fasterPace: Readonly<{ chipIndex: number; days: RatingFraction }> | null
      /** The exact average after the reviews needed, in hundredths, half up. */
      averageAfterHundredths: number
      /** The same reviews at the last 90 days' pace; null without a review in them. */
      daysAtTodaysPace: RatingFraction | null
    }>
