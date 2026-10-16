// The Property Google rating goal as its reads hand it to the page, for stories
// and tests. The numbers are the plan's worked example (docs/plan/
// google-rating-goal.md): 812 Google reviews, exact average 4.31 (Google shows
// 4.3), recent mix 4.70, 28 reviews in the last 28 days (7 a week), Faster 11.
import type {
  RatingGoalCardView,
  RatingGoalDetailView,
  RatingGoalForecastInputs,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
  RatingStopView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  ratingGoalPlanning,
  ratingGoalStops,
} from '#/contexts/reporting/application/rating-goal-planning'

export const FIXTURE_PROPERTY_ID = '6f2c1a52-8a4e-4d43-9d0c-2b6a8f1e9c11'
export const FIXTURE_GOAL_ID = '0b9e2f7a-3c41-4f6d-8a2b-5e7c9d1f3a24'
export const FIXTURE_TIMEZONE = 'Europe/Sofia'
/** When every fixture was read. */
export const FIXTURE_NOW = '2026-10-14T12:00:00.000Z'

const range = (fromMonth: string, toMonth: string | null) =>
  ({ kind: 'range', fromMonth, toMonth }) as const

/** The worked example as the setup read hands it to the page. */
const FORECAST_INPUTS: RatingGoalForecastInputs = {
  reviewCount: 812,
  displayedTenths: 43,
  exact: { num: 431, den: 100 },
  mix: { num: 47, den: 10 },
  bestYear: null,
  reviewsLast28Days: 28,
  timezone: FIXTURE_TIMEZONE,
  asOf: FIXTURE_NOW,
}

/**
 * Every target at its own recommended quality, worked out by the engine's own
 * planning from the inputs, so the page and its stories never disagree.
 */
const SETUP_STOPS: readonly RatingStopView[] = ratingGoalStops(FORECAST_INPUTS)

const GOOGLE = {
  shows: 4.3,
  reviewCount: 812,
  asOf: '2026-10-14T11:48:00.000Z',
  current: true,
} as const

export const SETUP: RatingGoalSetupView = {
  eligibility: { eligible: true },
  hasActiveGoal: false,
  google: GOOGLE,
  exactAverage: 4.31,
  exactAverageSource: 'cache',
  recentMix: { average: 4.7, reviewCount: 84, basis: 'last_90_days' },
  currentPacePerWeek: 7,
  paces: {
    steady: { perWeek: 7, perMonth: 30, perDay: 1 },
    faster: { perWeek: 11, perMonth: 48, perDay: 1.6 },
    push: { perWeek: 14, perMonth: 61, perDay: 2 },
  },
  stops: SETUP_STOPS,
  perfectStop: { targetTenths: 50, disabledReason: 'needs_every_review_5_star' },
  preselectedTenths: 44,
  offerKeepFirst: false,
  planning: ratingGoalPlanning(FORECAST_INPUTS),
  forecastInputs: FORECAST_INPUTS,
  // "Pick a plan" reads none of it; the one-screen setup's stories bring their own.
  setupInputs: null,
  offersClimb: true,
}

/** Property B of the beta: 19 reviews, all five stars, Google shows 5.0. */
export const SETUP_KEEP_FIRST: RatingGoalSetupView = {
  ...SETUP,
  google: { ...GOOGLE, shows: 5, reviewCount: 19 },
  exactAverage: 5,
  recentMix: { average: 5, reviewCount: 19, basis: 'most_recent' },
  currentPacePerWeek: 0.25,
  stops: [],
  perfectStop: null,
  preselectedTenths: null,
  offerKeepFirst: true,
  offersClimb: false,
  planning: null,
  forecastInputs: null,
}

export const SETUP_FEW_REVIEWS: RatingGoalSetupView = {
  ...SETUP,
  eligibility: { eligible: false, reason: 'few_reviews', reviewCount: 6 },
  google: { ...GOOGLE, shows: 4.8, reviewCount: 6 },
  stops: [],
  perfectStop: null,
  preselectedTenths: null,
  planning: null,
  forecastInputs: null,
  offersClimb: false,
}

export const CARD: RatingGoalCardView = {
  goalId: FIXTURE_GOAL_ID,
  version: 3,
  state: 'active',
  endedReason: null,
  mode: 'climb',
  targetTenths: 45,
  target: 4.5,
  qualityTenths: 47,
  quality: 4.7,
  paceTenthsPerWeek: 110,
  pacePerWeek: 11,
  status: 'on_pace',
  google: GOOGLE,
  exactAverage: 4.382,
  exactAverageSource: 'cache',
  threshold: 4.45,
  progress: 0.52,
  googleShowsSoon: false,
  thisWeekCount: 6,
  justSet: false,
  forecast: range('2027-07', '2027-09'),
  forecastBasis: 'actual_pace',
  qualityBasis: 'since_set',
  setAt: '2026-08-03T09:00:00.000Z',
}

export const CARD_JUST_SET: RatingGoalCardView = {
  ...CARD,
  status: 'getting_started',
  exactAverage: 4.31,
  progress: 0,
  thisWeekCount: 0,
  justSet: true,
  forecast: range('2027-04', '2028-04'),
  forecastBasis: 'chosen_pace',
  qualityBasis: 'planned',
  setAt: '2026-10-13T09:00:00.000Z',
}

/** A goal to keep, which is set only while Google shows 4.9 or 5.0 (R2-9). */
export const CARD_KEEP: RatingGoalCardView = {
  ...CARD,
  mode: 'keep',
  targetTenths: 49,
  target: 4.9,
  qualityTenths: null,
  quality: null,
  paceTenthsPerWeek: null,
  pacePerWeek: null,
  status: 'holding',
  google: { ...GOOGLE, shows: 4.9 },
  exactAverage: 4.912,
  threshold: 4.85,
  progress: null,
  forecast: null,
  forecastBasis: null,
  qualityBasis: null,
}

export const CARD_REACHED: RatingGoalCardView = {
  ...CARD,
  state: 'reached',
  status: 'reached',
  google: { ...GOOGLE, shows: 4.5 },
  exactAverage: 4.452,
  progress: 1,
  forecast: null,
}

export const DETAIL: RatingGoalDetailView = {
  ...CARD,
  lastFourWeeksPerWeek: 9.5,
  stillNeeded: 212,
  bestCase: 97,
  forecastAtChosenPace: range('2027-03', '2027-11'),
  forecastAtActualPace: range('2027-07', '2027-09'),
  nextTenth: { targetTenths: 44, target: 4.4, reviewsNeeded: 31 },
  recentMix: { average: 4.7, reviewCount: 84, basis: 'last_90_days' },
  baseline: { googleShows: 4.3, reviewCount: 812, exactAverage: 4.31 },
  weeks: [
    { weekStart: '2026-08-03', count: 9 },
    { weekStart: '2026-08-10', count: 12 },
    { weekStart: '2026-08-17', count: 11 },
    { weekStart: '2026-08-24', count: 8 },
    { weekStart: '2026-08-31', count: 13 },
    { weekStart: '2026-09-07', count: 10 },
    { weekStart: '2026-09-14', count: 7 },
    { weekStart: '2026-09-21', count: 12 },
    { weekStart: '2026-09-28', count: 9 },
    { weekStart: '2026-10-05', count: 10 },
    { weekStart: '2026-10-12', count: 6 },
  ],
  starsSinceSet: [
    { stars: 5, count: 82 },
    { stars: 4, count: 16 },
    { stars: 3, count: 4 },
    { stars: 2, count: 2 },
    { stars: 1, count: 3 },
  ],
  changes: [
    {
      changedBy: 'user-ana',
      changedAt: '2026-09-02T08:15:00.000Z',
      field: 'pace',
      oldValue: '14',
      newValue: '11',
    },
    {
      changedBy: 'user-ana',
      changedAt: '2026-08-20T07:30:00.000Z',
      field: 'target',
      oldValue: '44',
      newValue: '45',
    },
  ],
  plan: {
    targetTenths: 45,
    googleShowsTenths: 43,
    qualityTenths: 47,
    sinceSet: { reviewCount: 107, average: 4.607, averageTenths: 46 },
    qualityBasis: 'since_set',
    paceTenthsPerWeek: 110,
    pacePerWeek: 11,
    lastFourWeeksPerWeek: 9.5,
    forecast: range('2027-07', '2027-09'),
  },
}

export const HISTORY: readonly RatingGoalHistoryEntry[] = [
  {
    goalId: '5d1e8c3b-7a92-4b16-9f0e-3c2a6d8b4e57',
    mode: 'climb',
    targetTenths: 43,
    target: 4.3,
    qualityTenths: 46,
    paceTenthsPerWeek: 90,
    pacePerWeek: 9,
    state: 'reached',
    endedReason: null,
    setAt: '2026-03-02T09:00:00.000Z',
    setBy: 'user-ana',
    reachedAt: '2026-07-28T05:10:00.000Z',
    endedAt: null,
    baselineGoogleShows: 4.2,
  },
  {
    goalId: '9a4f2c6e-1b37-4d58-8e0a-7f3b5c9d2e61',
    mode: 'keep',
    targetTenths: 42,
    target: 4.2,
    qualityTenths: null,
    paceTenthsPerWeek: null,
    pacePerWeek: null,
    state: 'ended',
    endedReason: 'google_location_changed',
    setAt: '2025-11-10T09:00:00.000Z',
    setBy: 'user-ana',
    reachedAt: null,
    endedAt: '2026-02-20T14:00:00.000Z',
    baselineGoogleShows: 4.2,
  },
]
