// Property Google rating goal — what its reads return (types only).
//
// No zod and no values here: the UI imports these with `import type`, so the
// goal pages carry none of the command schemas into first paint (#794). The
// command schemas live in rating-goal.dto.ts.
//
// Numbers are plain decimals for display: a target 4.5 also comes as
// `targetTenths` 45, the exact average to three decimals, a pace a day to one.
// "Google shows" is always Google's own one-decimal number.

import type {
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
} from '../../domain/rating-goal'
import type {
  RatingGoalEligibility,
  RatingStopLabel,
} from '../../domain/rating-goal-stops'

export type {
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
  RatingStopLabel,
}

export type RatingPaceKey = 'steady' | 'faster' | 'push'

/**
 * Where the exact average comes from: `cache` when RepKey holds every review
 * Google counts, `google` when it does not and the figure is Google's own
 * one-decimal number, so every sentence about it says "about".
 */
export type RatingExactAverageSource = 'cache' | 'google'

/** When a target is expected. `YYYY-MM` months in the Property's time zone. */
export type RatingForecastView =
  /** The recent mix does not clear the target: no pace reaches it. */
  | Readonly<{ kind: 'unreachable' }>
  /** No reviews at the pace this forecast uses. */
  | Readonly<{ kind: 'no_pace' }>
  /** More than ten years away. */
  | Readonly<{ kind: 'beyond_horizon' }>
  /** `toMonth` is null when the late end is open. */
  | Readonly<{ kind: 'range'; fromMonth: string; toMonth: string | null }>

export type GoogleNumbersView = Readonly<{
  /** Google's one-decimal number (4.3); null when Google has no average. */
  shows: number | null
  reviewCount: number
  /** When Review last verified these numbers with Google (ISO). */
  asOf: string
  /** False when older than 24 hours or the Google binding is not active. */
  current: boolean
}>

export type RecentMixView = Readonly<{
  /** Average stars of the reviews the mix is taken from, three decimals. */
  average: number
  reviewCount: number
  basis: 'last_90_days' | 'most_recent'
}>

export type RatingPaceView = Readonly<{
  perWeek: number
  perMonth: number
  perDay: number
}>

export type RatingStopView = Readonly<{
  targetTenths: number
  target: number
  /** Null when no count of reviews at the recent mix gets there. */
  reviewsNeeded: number | null
  /** Reviews needed if every new review is five stars. */
  bestCase: number | null
  label: RatingStopLabel
  /** The forecast at each suggested pace. */
  forecasts: Readonly<Record<RatingPaceKey, RatingForecastView>>
}>

/**
 * Whether a goal may be set: `property_not_active` first, then `few_reviews`
 * (Google's count, current or not), then `waiting_for_google`.
 */
export type RatingGoalEligibilityView = RatingGoalEligibility

/**
 * The exact inputs the forecast is worked out from, for a pace the manager
 * types in (`previewRatingGoalPace`). Averages are fractions.
 */
export type RatingGoalForecastInputs = Readonly<{
  reviewCount: number
  exact: Readonly<{ num: number; den: number }>
  mix: Readonly<{ num: number; den: number }>
  reviewsLast28Days: number
  timezone: string
  /** The instant the forecast counts from (ISO). */
  asOf: string
}>

export type RatingGoalSetupView = Readonly<{
  eligibility: RatingGoalEligibilityView
  /** True when the Property already has an active rating goal. */
  hasActiveGoal: boolean
  google: GoogleNumbersView | null
  exactAverage: number | null
  exactAverageSource: RatingExactAverageSource | null
  recentMix: RecentMixView | null
  /** Reviews of the last 28 days per week, two decimals. */
  currentPacePerWeek: number
  paces: Readonly<Record<RatingPaceKey, RatingPaceView>>
  stops: readonly RatingStopView[]
  /** 5.0, shown disabled with its reason while Google shows less. */
  perfectStop: Readonly<{
    targetTenths: 50
    disabledReason: 'needs_every_review_5_star'
  }> | null
  preselectedTenths: number | null
  offerKeepFirst: boolean
  forecastInputs: RatingGoalForecastInputs | null
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
  pacePerWeek: number | null
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
  /** Null for a keep goal. */
  forecast: RatingForecastView | null
  /** The chosen pace until the goal is 28 days old, then the actual pace. */
  forecastBasis: 'chosen_pace' | 'actual_pace' | null
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
  }>

export type RatingGoalHistoryEntry = Readonly<{
  goalId: string
  mode: RatingGoalMode
  targetTenths: number
  target: number
  pacePerWeek: number | null
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

/** A pace the manager types in, worked out for one target. */
export type RatingGoalPacePreview = Readonly<{
  pace: RatingPaceView
  forecast: RatingForecastView
  /** Above twice the current pace: Google may flag a surge. */
  surgeCaution: boolean
}>
