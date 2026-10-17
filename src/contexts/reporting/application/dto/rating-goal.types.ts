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
import type { RatingFraction, RatingGoalSetupInputs } from './rating-goal-setup.types'

export type {
  GoogleNumbersView,
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalStatus,
}

/**
 * `planned` while no review arrived since the goal was set, `blended` from the
 * first, `since_set` while they are too low for the target.
 */
export type RatingQualityBasis = QualityBasis

/**
 * Where the exact average comes from: `cache` when RepKey holds every review
 * Google counts, `google` when it does not and the figure is Google's own
 * one-decimal number, so every sentence about it says "about".
 */
export type RatingExactAverageSource = 'cache' | 'google'

/**
 * When a target is expected, as durations from today in exact days (round 5,
 * PLAN-D E1/E3): the central time and the likely range (new reviews 0.1★
 * better at 10% more a week, and 0.1★ worse at 10% less). No calendar date.
 */
export type RatingArrivalView =
  /** The average new reviews are expected to bring does not clear the target: no pace reaches it. */
  | Readonly<{ kind: 'unreachable' }>
  /** No reviews at the pace this arrival uses. */
  | Readonly<{ kind: 'no_pace' }>
  /** The cache already clears the target; Google does not show it yet. */
  | Readonly<{ kind: 'earned' }>
  /** `slow` is null when the late end is open. */
  | Readonly<{
      kind: 'days'
      central: RatingFraction
      fast: RatingFraction
      slow: RatingFraction | null
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
  /** The cache has crossed the threshold; Google does not show it yet. */
  googleShowsSoon: boolean
  /** Reviews created this Monday-to-Sunday week. */
  thisWeekCount: number
  /** Set in the last 7 days: "Aim for about N new reviews a week". */
  justSet: boolean
  /**
   * Null for a keep goal. At the planned quality blended with the reviews
   * since the goal was set, or at their average while they are too low
   * (`qualityBasis`).
   */
  forecast: RatingArrivalView | null
  /** The chosen pace until the goal is 28 days old, then the actual pace. */
  forecastBasis: 'chosen_pace' | 'actual_pace' | null
  /** Null for a keep goal. */
  qualityBasis: RatingQualityBasis | null
  setAt: string
  /**
   * The number the card counts to (PLAN-D E5): the tenth above what the
   * reviews have earned, at most the goal, with the new reviews it takes
   * (never 0). Null for a keep goal, without Google's numbers, once the
   * reviews have earned the goal (`googleShowsSoon`) or when no average
   * reaches it.
   */
  next: Readonly<{ targetTenths: number; target: number; reviewsNeeded: number }> | null
  /** A tenth the cache clears and Google does not show yet, short of the goal: "Google should show 4.4 soon". */
  earnedTenths: number | null
  /** New reviews to the goal itself; null for a keep goal or when no average reaches it. */
  stillNeeded: number | null
  /** Reviews of the last 28 days per week, two decimals. */
  lastFourWeeksPerWeek: number
  /** What Google showed, and the cache held, when the goal was set. */
  baseline: Readonly<{ googleShows: number; reviewCount: number; exactAverage: number }>
  /**
   * The number above the goal, "possible in about N" (R4-4), at the same pace
   * as `forecast`: the reviews it takes beyond the goal and the days to it
   * from today. Null for a keep goal, at 4.9, or when the average does not
   * clear it.
   */
  nextUp: Readonly<{
    targetTenths: number
    reviewsBeyondGoal: number
    days: RatingFraction
  }> | null
  /**
   * The day of the Property week, 1 Monday … 7 Sunday, worked out on the
   * server at every card read (PLAN-D E9). A page that stays focused past
   * midnight shows the day before until its next read.
   */
  weekday: number
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
    /** Their average to three decimals; null until ten arrived, as the verdict waits ("after 10 reviews"). */
    average: number | null
    /** Their average as a tenth, half up; null until ten reviews arrived. */
    averageTenths: number | null
  }>
  qualityBasis: RatingQualityBasis
  /** The average the goal's numbers assume (`qualityBasis`), to three decimals. */
  assumedAverage: number
  /** Pace: the chosen pace in tenths a week, against the last four weeks (a decimal a week). */
  paceTenthsPerWeek: number
  lastFourWeeksPerWeek: number
  /** At so-far values: the quality the goal now assumes and the last four weeks' pace. */
  forecast: RatingArrivalView
}>

/** One day of the detail's chart: 0 is today, negative before it; a star in thousandths. */
export type RatingGoalChartPoint = Readonly<{ day: number; thousandths: number }>

/** One week of the plan's cone or the likely band, in thousandths of a star. */
export type RatingGoalBandPoint = Readonly<{ day: number; low: number; high: number }>

/**
 * "The climb, step by step" (round 5, PLAN-D E12–E16): Google's exact average
 * over time, the plan as a cone from its latest change (else the set), the
 * likely band from today, the lines where Google shows each tenth and when
 * Google's own number changed. Days are whole Property-local days from today,
 * every star value in thousandths: the page draws, it works nothing out.
 */
export type RatingGoalChartView = Readonly<{
  /** The chart's first day: four weeks before the set's week, a year back at most. */
  firstDay: number
  /** At the start, at each week's end and today; null while RepKey lacks some of Google's reviews. */
  history: readonly RatingGoalChartPoint[] | null
  /** The exact average at which Google shows each tenth, from below the start to above the goal. */
  thresholds: readonly Readonly<{ tenths: number; thousandths: number }>[]
  /** Where the plan's cone starts: the set, or the latest change of the plan. */
  anchor: Readonly<{
    day: number
    kind: 'set' | 'changed'
    paceTenthsPerWeek: number
    qualityTenths: number
  }>
  /** Empty when there is no cone (a changed plan without the history to start it from). */
  plan: readonly RatingGoalBandPoint[]
  /** Empty when the goal has no arrival to draw (no pace, out of reach, reached). */
  likely: readonly RatingGoalBandPoint[]
  /** Each day Google's own number moved, up or down. */
  shownChanges: readonly Readonly<{ day: number; tenths: number; up: boolean }>[]
  /** Today's exact average; null while it is Google's own figure. */
  today: number | null
}>

/** "Your plan, so far": the pace before the goal, and the tenth reached since. */
export type RatingGoalPlanSoFarView = Readonly<{
  /** The four full weeks before the set's week, a month; null when the chart does not reach them. */
  prePlan: Readonly<{ perMonth: number; trend: 'up' | 'down' | 'same' }> | null
  /** What Google shows now, when it is more than when the goal was set. */
  reachedTenths: number | null
}>

/** "What moved you" without a per-review value (D-2): Google's number moving and what the goal was set with. */
export type RatingGoalMovedEvents = Readonly<{
  /** Each change of Google's own number since the goal was set, newest first. */
  shownChanges: readonly Readonly<{ at: string; tenths: number; up: boolean }>[]
  /** The user id that set the goal; the page names the person. */
  setBy: string
  initialTargetTenths: number
  /** Null for a goal set to keep a number. */
  initialPaceTenthsPerWeek: number | null
}>

/**
 * This Property-local week's new reviews and their stars (the owner's
 * exception, ADR 0067 2026-10-17): "2 new reviews, both 5★".
 */
export type RatingGoalThisWeekView = Readonly<{
  count: number
  /** Every review's stars when they all have the same; null otherwise or with none. */
  allStars: number | null
  /** Their average in tenths, half up; null with none. */
  averageTenths: number | null
}>

/**
 * A low review since the set as the detail read hands it to the server
 * function (D-2b, E17): the server turns `reviewId` into an Inbox item and
 * never sends it to the browser.
 */
export type RatingGoalLowReviewRead = Readonly<{
  reviewId: string
  /** When Google created it. */
  at: string
  stars: number
  /** The new reviews it set the goal back, about (whole, at least 1); null while no count reaches the goal. */
  setBack: number | null
}>

/** A low review as the page names it: the Inbox item that opens it, or none this viewer may open. */
export type RatingGoalLowReviewView = Omit<RatingGoalLowReviewRead, 'reviewId'> &
  Readonly<{ inboxItemId: string | null }>

/** "What moved you": the events, this week's stars and the low reviews since the set. */
export type RatingGoalMovedView<LowReview = RatingGoalLowReviewView> =
  RatingGoalMovedEvents &
    Readonly<{
      thisWeek: RatingGoalThisWeekView
      /** Newest first, ten at most; none for a keep goal or one reached or ended. */
      lowReviews: readonly LowReview[]
    }>

export type RatingGoalDetailView<LowReview = RatingGoalLowReviewView> =
  RatingGoalCardView &
    Readonly<{
      forecastAtChosenPace: RatingArrivalView | null
      forecastAtActualPace: RatingArrivalView | null
      changes: readonly RatingGoalChangeView[]
      /** Null for a keep goal or without Google's numbers. */
      plan: RatingGoalPlanProgressView | null
      /** Null for a keep goal. */
      chart: RatingGoalChartView | null
      planSoFar: RatingGoalPlanSoFarView
      moved: RatingGoalMovedView<LowReview>
    }>

/** The detail as the use case returns it, before the server links the low reviews to the Inbox. */
export type RatingGoalDetailRead = RatingGoalDetailView<RatingGoalLowReviewRead>

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
