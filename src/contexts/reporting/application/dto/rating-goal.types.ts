// Property Google rating goal — what its reads return (types only).
//
// No zod and no values here: the UI imports these with `import type`, so the
// goal pages carry none of the command schemas into first paint (#794). The
// command schemas live in rating-goal.dto.ts.
//
// Numbers are plain decimals for display: a target 4.5 also comes as
// `targetTenths` 45, the exact average to three decimals; a pace is in tenths
// of a review a week.
// "Google shows" is always Google's own one-decimal number.

import type {
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
} from '../../domain/rating-goal'
import type { RatingGoalEligibility } from '../../domain/rating-goal-stops'
import type { GoogleNumbersView } from '../../domain/google-numbers'
import type { QualityBasis } from '../../domain/rating-goal-status'
import type { RatingGoalSetupInputs } from './rating-goal-setup.types'

export type {
  GoogleNumbersView,
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
}

/** `planned` until ten reviews arrived since the goal was set, then `since_set`. */
export type RatingQualityBasis = QualityBasis

/**
 * Where the exact average comes from: `cache` when RepKey holds every review
 * Google counts, `google` when it does not and the figure is Google's own
 * one-decimal number, so every sentence about it says "about".
 */
export type RatingExactAverageSource = 'cache' | 'google'

/** When a target is expected. `YYYY-MM` months in the Property's time zone. */
export type RatingForecastView =
  /** The quality new reviews are expected to bring does not clear the target: no pace reaches it. */
  | Readonly<{ kind: 'unreachable' }>
  /** No reviews at the pace this forecast uses. */
  | Readonly<{ kind: 'no_pace' }>
  /** More than ten years away. */
  | Readonly<{ kind: 'beyond_horizon' }>
  /** `toMonth` is null when the late end is open. */
  | Readonly<{ kind: 'range'; fromMonth: string; toMonth: string | null }>

export type RecentMixView = Readonly<{
  /** Average stars of the reviews the mix is taken from, three decimals. */
  average: number
  reviewCount: number
  basis: 'last_90_days' | 'most_recent'
}>

/**
 * Whether a goal may be set: `property_not_active` first, then `few_reviews`
 * (Google's count, current or not), then `waiting_for_google`.
 */
export type RatingGoalEligibilityView = RatingGoalEligibility

export type RatingGoalSetupView = Readonly<{
  eligibility: RatingGoalEligibilityView
  /** True when the Property already has an active rating goal. */
  hasActiveGoal: boolean
  google: GoogleNumbersView | null
  exactAverage: number | null
  exactAverageSource: RatingExactAverageSource | null
  /** Google shows 4.9 or 5.0: Keep is offered first, in place of a climb. */
  offerKeepFirst: boolean
  /**
   * What the one-screen setup works its plan out from (rounds 3 and 4); null
   * while Google's numbers are waiting or show no tenth.
   */
  setupInputs: RatingGoalSetupInputs | null
  /**
   * A goal to climb can be planned: eligible, with inputs, and the reviews
   * have earned less than 4.9 (so Google shows less too, and is not catching
   * up with a 4.9, D28). Worked out with no planning maths (D18).
   */
  offersClimb: boolean
}>

export type RatingGoalCardView = Readonly<{
  goalId: string
  version: number
  /**
   * `active`, or the step the read that returned it took: a goal that this
   * read found reached (Google shows the target) or ended (its Google location
   * changed, or its Property was archived) is returned this once, then sits in
   * History.
   */
  state: 'active' | 'reached' | 'ended'
  endedReason: RatingGoalEndedReason | null
  mode: RatingGoalMode
  targetTenths: number
  target: number
  /** The planned quality of new reviews, in tenths; null for a keep goal. */
  qualityTenths: number | null
  quality: number | null
  /** The pace in tenths of a review a week (105 is 1.5 a day); null for a keep goal. */
  paceTenthsPerWeek: number | null
  status: RatingGoalStatus
  google: GoogleNumbersView | null
  exactAverage: number | null
  /** Null when there is no exact average. */
  exactAverageSource: RatingExactAverageSource | null
  /** The exact average at which Google shows the target (4.45 for 4.5). */
  threshold: number
  /** From the baseline to the threshold, 0 to 1; null for a keep goal. */
  progress: number | null
  /** The cache has crossed the threshold; Google does not show it yet. */
  googleShowsSoon: boolean
  /** Reviews created this Monday-to-Sunday week. */
  thisWeekCount: number
  /** Set in the last 7 days: "Aim for about N new reviews a week". */
  justSet: boolean
  /**
   * Null for a keep goal. At the planned quality until ten reviews arrived
   * since the goal was set, then at their average (`qualityBasis`).
   */
  forecast: RatingForecastView | null
  /** The chosen pace until the goal is 28 days old, then the actual pace. */
  forecastBasis: 'chosen_pace' | 'actual_pace' | null
  /** Null for a keep goal. */
  qualityBasis: RatingQualityBasis | null
  setAt: string
}>

export type RatingGoalChangeView = Readonly<{
  /** The user id; the page names the person. */
  changedBy: string
  changedAt: string
  field: RatingGoalChangeField
  oldValue: string | null
  newValue: string | null
}>

/**
 * "Your plan" on the detail page: the plan beside what happened since it was
 * set, for the goal, new reviews and pace, then the forecast at those values.
 */
export type RatingGoalPlanProgressView = Readonly<{
  /** Goal: the target, and the tenth Google shows now (null without its number). */
  targetTenths: number
  googleShowsTenths: number | null
  /** New reviews: the planned quality against the reviews since the goal was set. */
  qualityTenths: number
  sinceSet: Readonly<{
    reviewCount: number
    /** Their average to three decimals; null until ten reviews arrived ("after 10 reviews"). */
    average: number | null
    /** Their average as a tenth, half up; null until ten reviews arrived. */
    averageTenths: number | null
  }>
  qualityBasis: RatingQualityBasis
  /** Pace: the chosen pace in tenths a week, against the last four weeks (a decimal a week). */
  paceTenthsPerWeek: number
  lastFourWeeksPerWeek: number
  /** At so-far values: the quality the goal now assumes and the last four weeks' pace. */
  forecast: RatingForecastView
}>

export type RatingGoalDetailView = RatingGoalCardView &
  Readonly<{
    /** Reviews of the last 28 days per week, two decimals. */
    lastFourWeeksPerWeek: number
    stillNeeded: number | null
    bestCase: number | null
    forecastAtChosenPace: RatingForecastView | null
    forecastAtActualPace: RatingForecastView | null
    nextTenth: Readonly<{
      targetTenths: number
      target: number
      reviewsNeeded: number | null
    }> | null
    recentMix: RecentMixView | null
    baseline: Readonly<{ googleShows: number; reviewCount: number; exactAverage: number }>
    /** Monday-to-Sunday weeks since the goal was set, a year at most. */
    weeks: readonly Readonly<{ weekStart: string; count: number }>[]
    /** Stars of the reviews created since the goal was set. */
    starsSinceSet: readonly Readonly<{ stars: number; count: number }>[]
    changes: readonly RatingGoalChangeView[]
    /** Null for a keep goal or without Google's numbers. */
    plan: RatingGoalPlanProgressView | null
  }>

export type RatingGoalHistoryEntry = Readonly<{
  goalId: string
  mode: RatingGoalMode
  targetTenths: number
  target: number
  qualityTenths: number | null
  /** In tenths of a review a week. */
  paceTenthsPerWeek: number | null
  state: 'reached' | 'ended'
  endedReason: RatingGoalEndedReason | null
  setAt: string
  setBy: string
  reachedAt: string | null
  endedAt: string | null
  baselineGoogleShows: number
}>

export type RatingGoalSetResult = Readonly<{ goalId: string; version: number }>
export type RatingGoalChangeResult = Readonly<{ goalId: string; version: number }>
export type RatingGoalEndResult = Readonly<{ goalId: string; ended: true }>

/** "Not now" was recorded for the Property's rating goal (or already was). */
export type RatingGoalNotNowResult = Readonly<{ propertyId: string }>
