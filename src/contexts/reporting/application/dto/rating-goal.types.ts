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
import type { GoogleNumbersView } from '../../domain/google-numbers'
import type { PaceKey } from '../../domain/rating-goal-pace'
import type { RatingPlanKey } from '../../domain/rating-goal-plans'
import type { QualityAnchorKind } from '../../domain/rating-goal-quality'
import type { QualityBasis } from '../../domain/rating-goal-status'
import type { RatingGoalSetupInputs } from './rating-goal-setup.types'

export type {
  GoogleNumbersView,
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
  RatingPlanKey,
  RatingStopLabel,
}

export type RatingPaceKey = PaceKey

/**
 * Where a planned quality comes from: `like_now` the recent mix, `best_year`
 * the best calendar year with ten reviews (with its `year`), `step_above`
 * "a step above what {T} needs", `excellent` 4.8★.
 */
export type RatingQualityAnchorKind = QualityAnchorKind

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

export type RatingPaceView = Readonly<{
  perWeek: number
  perMonth: number
  perDay: number
}>

/**
 * One target from the next tenth to 4.9, worked out at its own recommended
 * planned quality (round 2), its label at the Faster pace.
 */
export type RatingStopView = Readonly<{
  targetTenths: number
  target: number
  /** The planned quality this stop is worked out at, in tenths: its recommendation. */
  qualityTenths: number
  quality: number
  qualityAnchor: RatingQualityAnchorKind
  /** Null when no count of reviews at that quality gets there (never, at the floor). */
  reviewsNeeded: number | null
  /** Reviews needed if every new review is five stars. */
  bestCase: number | null
  label: RatingStopLabel
  /** The forecast at each suggested pace, at the stop's quality. */
  forecasts: Readonly<Record<RatingPaceKey, RatingForecastView>>
}>

/** One planned quality a manager may pick, with its evidence and its cost. */
export type RatingQualityOptionView = Readonly<{
  kind: RatingQualityAnchorKind
  qualityTenths: number
  quality: number
  /** The calendar year of `best_year`; null for every other kind. */
  year: number | null
  recommended: boolean
  /** Reviews needed at this quality for the choice's target ("about 19 reviews"). */
  reviewsNeeded: number | null
}>

/**
 * The quality options of one target ("New reviews will average"): up to three
 * evidence anchors, the recommendation in the middle where it can be, lowest
 * first. "Own" takes any tenth from `minimumTenths` to 5.0.
 */
export type RatingQualityChoiceView = Readonly<{
  targetTenths: number
  /** The target's threshold plus 0.15★, as a tenth: the lowest quality a plan may assume. */
  minimumTenths: number
  options: readonly RatingQualityOptionView[]
  recommended: RatingQualityOptionView
}>

/** One option of the target row ("Goal on Google"), labelled as its stop is. */
export type RatingTargetOptionView = Readonly<{
  targetTenths: number
  target: number
  label: RatingStopLabel
  recommended: boolean
}>

/** A complete plan: target, planned quality, weekly pace, what it needs and when. */
export type RatingPlanView = Readonly<{
  key: RatingPlanKey
  targetTenths: number
  target: number
  qualityTenths: number
  quality: number
  paceKey: RatingPaceKey
  pace: RatingPaceView
  reviewsNeeded: number | null
  bestCase: number | null
  forecast: RatingForecastView
  /**
   * How far the plan is at its own pace, by the rule that labels a target:
   * Realistic within 26 weeks, Stretch within 52, Out of reach beyond. The
   * cards show no label; one out of reach says "More than a year".
   */
  reach: RatingStopLabel
}>

/**
 * "Pick a plan": three plans that share one planned quality, and the rows of
 * "Build your own". Null in the setup view when Google shows 4.9 or 5.0 (Keep
 * is offered instead) or there are no numbers to plan with.
 */
export type RatingGoalPlanningView = Readonly<{
  recommendedTargetTenths: number
  /**
   * The quality every plan assumes, and its options for "Change": the
   * recommended target's choice ("Plans assume new reviews average 4.5★, like
   * your best year (2024)").
   */
  quality: RatingQualityChoiceView
  /** Cautious, Recommended (preselected) and Ambitious, in that order. */
  plans: readonly RatingPlanView[]
  /** "Goal on Google": the target row, lowest first. */
  targets: readonly RatingTargetOptionView[]
  /** "New reviews a week": Faster is recommended; the paces are the setup view's `paces`. */
  recommendedPaceKey: RatingPaceKey
}>

/**
 * Whether a goal may be set: `property_not_active` first, then `few_reviews`
 * (Google's count, current or not), then `waiting_for_google`.
 */
export type RatingGoalEligibilityView = RatingGoalEligibility

/**
 * The exact inputs plans and forecasts are worked out from, so the page can
 * work out what a manager changes with no server call
 * (`rating-goal-planning.ts`, `rating-goal-preview.ts`). Averages are fractions.
 */
export type RatingGoalForecastInputs = Readonly<{
  reviewCount: number
  /** The tenth Google shows. */
  displayedTenths: number
  exact: Readonly<{ num: number; den: number }>
  /** The recent mix ("Like now"). */
  mix: Readonly<{ num: number; den: number }>
  /** The best calendar year with ten reviews ("Like your best year"), or none. */
  bestYear: Readonly<{
    year: number
    average: Readonly<{ num: number; den: number }>
    reviewCount: number
  }> | null
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
  /** The recommended target: the highest Realistic stop up to +0.3, else the next tenth. */
  preselectedTenths: number | null
  /** Google shows 4.9 or 5.0: Keep is offered in place of plans. */
  offerKeepFirst: boolean
  planning: RatingGoalPlanningView | null
  forecastInputs: RatingGoalForecastInputs | null
  /**
   * What the one-screen setup works its plan out from (rounds 3 and 4); null
   * while Google's numbers are waiting or show no tenth.
   */
  setupInputs: RatingGoalSetupInputs | null
  /**
   * A goal to climb can be planned: eligible, with inputs, and Google shows
   * less than 4.9. Worked out with no planning maths (D18).
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
  /** The same pace a week, a decimal (10.5); "Pick a plan" reads it until it is replaced. */
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
  /**
   * Pace: the chosen pace, in tenths a week and as a decimal a week, against
   * the last four weeks (two decimals).
   */
  paceTenthsPerWeek: number
  pacePerWeek: number
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
  /** In tenths of a review a week; `pacePerWeek` is the same a week, a decimal. */
  paceTenthsPerWeek: number | null
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

/** "Not now" was recorded for the Property's rating goal (or already was). */
export type RatingGoalNotNowResult = Readonly<{ propertyId: string }>

/** A pace the manager types in, worked out for one target at its recommended quality. */
export type RatingGoalPacePreview = Readonly<{
  pace: RatingPaceView
  forecast: RatingForecastView
  /** Above twice the current pace: Google may flag a surge. */
  surgeCaution: boolean
}>

/** What "Build your own" was given: a target, a planned quality and a weekly pace. */
export type RatingGoalPlanDraft = Readonly<{
  targetTenths: number
  qualityTenths: number
  pacePerWeek: number
}>

/** Why a draft plan cannot be set, one per field at most. */
export type RatingPlanProblem =
  /** A target from the tenth above what Google shows to 4.9, in tenths. */
  | Readonly<{
      field: 'target'
      code: 'target_out_of_range'
      minimumTenths: number
      maximumTenths: number
    }>
  /** Below the target's floor: "For 4.0, new reviews need to average 4.1★ or more." */
  | Readonly<{ field: 'quality'; code: 'quality_too_low'; minimumTenths: number }>
  /** Above five stars, or not a whole tenth. */
  | Readonly<{ field: 'quality'; code: 'quality_out_of_range'; maximumTenths: number }>
  /** Whole new reviews a week, 1 to 200. */
  | Readonly<{
      field: 'pace'
      code: 'pace_out_of_range'
      minimum: number
      maximum: number
    }>

/** "Build your own"'s live total, or why the draft cannot be set. */
export type RatingGoalPlanPreview =
  | Readonly<{
      valid: true
      reviewsNeeded: number | null
      bestCase: number | null
      pace: RatingPaceView
      forecast: RatingForecastView
      /** Above twice the current pace: Google may flag a surge. */
      surgeCaution: boolean
      /** How far the plan is at its own pace, as a plan's `reach`. */
      reach: RatingStopLabel
    }>
  | Readonly<{ valid: false; problems: readonly RatingPlanProblem[] }>
