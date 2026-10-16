// The Property Google rating goal as its reads hand it to the page, for stories
// and tests. The numbers are the plan's worked example (docs/plan/
// google-rating-goal.md): 812 Google reviews, exact average 4.31 (Google shows
// 4.3), 84 reviews in the last 90 days, a goal at 11 a week (110 tenths). The
// one-screen setup's approved scenarios are in rating-goal-setup.stories.fixtures.ts.
import type {
  RatingGoalCardView,
  RatingGoalDetailView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'

export const FIXTURE_PROPERTY_ID = '6f2c1a52-8a4e-4d43-9d0c-2b6a8f1e9c11'
export const FIXTURE_GOAL_ID = '0b9e2f7a-3c41-4f6d-8a2b-5e7c9d1f3a24'
export const FIXTURE_TIMEZONE = 'Europe/Sofia'
/** When every fixture was read. */
export const FIXTURE_NOW = '2026-10-14T12:00:00.000Z'

/** An arrival in whole days from today: the central time and the likely range. */
export const inDays = (central: number, fast: number, slow: number | null) =>
  ({
    kind: 'days',
    central: { num: central, den: 1 },
    fast: { num: fast, den: 1 },
    slow: slow === null ? null : { num: slow, den: 1 },
  }) as const

/** The worked example as the setup read hands it to the page. */
const SETUP_INPUTS: RatingGoalSetupInputs = {
  reviewCount: 812,
  displayedTenths: 43,
  exact: { num: 431, den: 100 },
  exactSource: 'cache',
  bestMonth: null,
  bestYear: null,
  reviewsLast90Days: 84,
  busiest30Days: 30,
  timezone: FIXTURE_TIMEZONE,
  asOf: FIXTURE_NOW,
}

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
  offerKeepFirst: false,
  setupInputs: SETUP_INPUTS,
  offersClimb: true,
}

/** Property B of the beta: 19 reviews, all five stars, Google shows 5.0. */
export const SETUP_KEEP_FIRST: RatingGoalSetupView = {
  ...SETUP,
  google: { ...GOOGLE, shows: 5, reviewCount: 19 },
  exactAverage: 5,
  offerKeepFirst: true,
  setupInputs: {
    ...SETUP_INPUTS,
    reviewCount: 19,
    displayedTenths: 50,
    exact: { num: 5, den: 1 },
  },
  offersClimb: false,
}

export const SETUP_FEW_REVIEWS: RatingGoalSetupView = {
  ...SETUP,
  eligibility: { eligible: false, reason: 'few_reviews', reviewCount: 6 },
  google: { ...GOOGLE, shows: 4.8, reviewCount: 6 },
  setupInputs: null,
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
  status: 'on_pace',
  google: GOOGLE,
  exactAverage: 4.382,
  exactAverageSource: 'cache',
  threshold: 4.45,
  progress: 0.52,
  googleShowsSoon: false,
  thisWeekCount: 6,
  justSet: false,
  // 212 reviews at 9.5 a week (38 in the last 28 days).
  forecast: inDays(156, 120, 230),
  forecastBasis: 'actual_pace',
  qualityBasis: 'blended',
  setAt: '2026-08-03T09:00:00.000Z',
  next: { targetTenths: 44, target: 4.4, reviewsNeeded: 31 },
  earnedTenths: null,
  stillNeeded: 212,
  lastFourWeeksPerWeek: 9.5,
  baseline: { googleShows: 4.3, reviewCount: 812, exactAverage: 4.31 },
  nextUp: null,
  // 14 Oct 2026 is a Wednesday.
  weekday: 3,
}

export const CARD_JUST_SET: RatingGoalCardView = {
  ...CARD,
  status: 'getting_started',
  exactAverage: 4.31,
  progress: 0,
  thisWeekCount: 0,
  justSet: true,
  // 454 reviews at 11 a week.
  forecast: inDays(289, 210, 420),
  forecastBasis: 'chosen_pace',
  qualityBasis: 'planned',
  setAt: '2026-10-13T09:00:00.000Z',
  next: { targetTenths: 44, target: 4.4, reviewsNeeded: 109 },
  stillNeeded: 454,
}

/** A goal to keep, which is set from a shown 4.7 (X1; R2-9 said 4.9). */
export const CARD_KEEP: RatingGoalCardView = {
  ...CARD,
  mode: 'keep',
  targetTenths: 49,
  target: 4.9,
  qualityTenths: null,
  quality: null,
  paceTenthsPerWeek: null,
  status: 'holding',
  google: { ...GOOGLE, shows: 4.9 },
  exactAverage: 4.912,
  threshold: 4.85,
  progress: null,
  forecast: null,
  forecastBasis: null,
  qualityBasis: null,
  next: null,
  stillNeeded: null,
}

export const CARD_REACHED: RatingGoalCardView = {
  ...CARD,
  state: 'reached',
  status: 'reached',
  google: { ...GOOGLE, shows: 4.5 },
  exactAverage: 4.452,
  progress: 1,
  forecast: null,
  next: null,
  stillNeeded: null,
}

export const DETAIL: RatingGoalDetailView = {
  ...CARD,
  bestCase: 97,
  // 212 reviews at 11 a week, then at 9.5.
  forecastAtChosenPace: inDays(135, 104, 199),
  forecastAtActualPace: inDays(156, 120, 230),
  recentMix: { average: 4.7, reviewCount: 84, basis: 'last_90_days' },
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
      // As logged: tenths of a review a week.
      oldValue: '140',
      newValue: '110',
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
    qualityBasis: 'blended',
    // 493 stars from 107 reviews beside the plan's 4.7★ counted as 15: 563.5 / 122.
    assumedAverage: 4.619,
    paceTenthsPerWeek: 110,
    lastFourWeeksPerWeek: 9.5,
    forecast: inDays(156, 120, 230),
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
    state: 'ended',
    endedReason: 'google_location_changed',
    setAt: '2025-11-10T09:00:00.000Z',
    setBy: 'user-ana',
    reachedAt: null,
    endedAt: '2026-02-20T14:00:00.000Z',
    baselineGoogleShows: 4.2,
  },
]
