// The beta Property of round 2 (2026-10-15), as the reads hand it to the page,
// for stories and tests: Google shows 3.9 from 261 reviews (1,021 stars, exact
// 3.9119) and 2024 had 26 reviews at 4.46 (Harborline Suites, the quiet hotel
// of the approved setup). The setup works its plan out from these inputs, as
// the page does, so the page and its stories never disagree.
import type {
  RatingGoalDetailView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { DETAIL, inDays, SETUP } from './rating-goal.stories.fixtures'
import { HARBORLINE } from './rating-goal-setup.stories.fixtures'

const BETA_GOOGLE = {
  shows: 3.9,
  reviewCount: 261,
  asOf: '2026-10-14T11:48:00.000Z',
  current: true,
} as const

/** The one-screen setup for the beta Property: it opens on 4.1 at its best year's 4.5★. */
export const SETUP_BETA: RatingGoalSetupView = {
  ...SETUP,
  google: BETA_GOOGLE,
  exactAverage: 3.912,
  setupInputs: HARBORLINE,
}

const BEFORE_TEN_PLAN: NonNullable<RatingGoalDetailView['plan']> = {
  targetTenths: 40,
  googleShowsTenths: 39,
  qualityTenths: 45,
  sinceSet: { reviewCount: 4, average: null, averageTenths: null },
  qualityBasis: 'blended',
  // 19 stars from 4 reviews beside the plan's 4.5★ counted as 15: 86.5 / 19.
  assumedAverage: 4.553,
  paceTenthsPerWeek: 20,
  lastFourWeeksPerWeek: 2,
  // 15 reviews at 2 a week.
  forecast: inDays(53, 40, 70),
}

/**
 * The beta Property's goal (4.0 at 4.5★, 2 a week) a fortnight in: four reviews
 * since it was set, so no verdict on their stars yet (R2-5); the numbers assume
 * the plan's 4.5★ mixed with them (round 4, X3).
 */
export const DETAIL_BEFORE_TEN: RatingGoalDetailView = {
  ...DETAIL,
  status: 'on_pace',
  targetTenths: 40,
  target: 4,
  qualityTenths: 45,
  quality: 4.5,
  paceTenthsPerWeek: 20,
  google: { ...BETA_GOOGLE, reviewCount: 265 },
  exactAverage: 3.921,
  threshold: 3.95,
  progress: 0.24,
  thisWeekCount: 1,
  justSet: false,
  forecast: inDays(53, 40, 70),
  forecastBasis: 'chosen_pace',
  qualityBasis: 'blended',
  setAt: '2026-09-30T09:00:00.000Z',
  lastFourWeeksPerWeek: 2,
  stillNeeded: 15,
  next: { targetTenths: 40, target: 4, reviewsNeeded: 15 },
  bestCase: 9,
  forecastAtChosenPace: inDays(53, 40, 70),
  forecastAtActualPace: inDays(53, 40, 70),
  nextTenth: null,
  recentMix: { average: 4, reviewCount: 25, basis: 'most_recent' },
  baseline: { googleShows: 3.9, reviewCount: 261, exactAverage: 3.912 },
  weeks: [
    { weekStart: '2026-09-28', count: 2 },
    { weekStart: '2026-10-05', count: 1 },
    { weekStart: '2026-10-12', count: 1 },
  ],
  starsSinceSet: [
    { stars: 5, count: 3 },
    { stars: 4, count: 1 },
  ],
  changes: [],
  plan: BEFORE_TEN_PLAN,
}

/**
 * The same goal later: twelve reviews since it was set average 3.75★, at or
 * below the 3.95 that 4.0 needs, so it is "New reviews too low for 4.0".
 */
export const DETAIL_TOO_LOW: RatingGoalDetailView = {
  ...DETAIL_BEFORE_TEN,
  status: 'reviews_too_low',
  google: { ...BETA_GOOGLE, reviewCount: 273 },
  exactAverage: 3.905,
  progress: 0,
  forecast: { kind: 'unreachable' },
  forecastBasis: 'actual_pace',
  qualityBasis: 'since_set',
  setAt: '2026-08-03T09:00:00.000Z',
  stillNeeded: null,
  next: null,
  bestCase: 12,
  forecastAtChosenPace: { kind: 'unreachable' },
  forecastAtActualPace: { kind: 'unreachable' },
  weeks: [0, 1, 0, 1, 0, 1, 1, 2, 2, 2, 2].map((count, index) => ({
    weekStart: new Date(Date.UTC(2026, 7, 3 + index * 7)).toISOString().slice(0, 10),
    count,
  })),
  // Twelve reviews, 45 stars: 3.75★.
  starsSinceSet: [
    { stars: 5, count: 5 },
    { stars: 4, count: 3 },
    { stars: 3, count: 2 },
    { stars: 1, count: 2 },
  ],
  plan: {
    ...BEFORE_TEN_PLAN,
    sinceSet: { reviewCount: 12, average: 3.75, averageTenths: 38 },
    qualityBasis: 'since_set',
    assumedAverage: 3.75,
    forecast: { kind: 'unreachable' },
  },
}
