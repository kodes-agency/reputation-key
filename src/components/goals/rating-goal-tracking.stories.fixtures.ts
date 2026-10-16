// The Google rating goal card of round 5 (PLAN-D D-1, mocks D2/D4) as the card
// read hands it to the page, for stories and tests. Harborline Suites, the
// quiet hotel of the approved setup, a few weeks after its goal of 4.1 at 1 a
// day: Google shows 4.0, up from 3.9, and 18 new reviews take it to 4.1. The
// other cards are the states the card has to draw. Every number is entered by
// hand from the worked examples of PLAN-D §2; the reads compute them.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { CARD, inDays } from './rating-goal.stories.fixtures'

const HARBORLINE_GOOGLE = {
  shows: 4,
  reviewCount: 300,
  asOf: '2026-10-14T11:48:00.000Z',
  current: true,
} as const

/** Google shows 4.0 from 3.9; 18 new reviews to 4.1; 2 of 7 this week, a Tuesday. */
export const CARD_HARBORLINE: RatingGoalCardView = {
  ...CARD,
  status: 'on_pace',
  targetTenths: 41,
  target: 4.1,
  qualityTenths: 45,
  quality: 4.5,
  paceTenthsPerWeek: 70,
  google: HARBORLINE_GOOGLE,
  exactAverage: 4.02,
  exactAverageSource: 'cache',
  threshold: 4.05,
  progress: 0.78,
  googleShowsSoon: false,
  thisWeekCount: 2,
  justSet: false,
  // 18 reviews at 1 a day; 13 and 29 days at the ends of the likely range.
  forecast: inDays(18, 13, 29),
  forecastBasis: 'chosen_pace',
  qualityBasis: 'blended',
  setAt: '2026-09-24T09:00:00.000Z',
  next: { targetTenths: 41, target: 4.1, reviewsNeeded: 18 },
  earnedTenths: null,
  stillNeeded: 18,
  lastFourWeeksPerWeek: 6.75,
  baseline: { googleShows: 3.9, reviewCount: 261, exactAverage: 3.912 },
  nextUp: { targetTenths: 42, reviewsBeyondGoal: 95, days: { num: 113, den: 1 } },
  weekday: 2,
}

/** Five weeks in: the card works at the pace of the last four weeks and says so. */
export const CARD_ACTUAL_PACE: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  forecastBasis: 'actual_pace',
  // 18 reviews at 27 in the last 28 days.
  forecast: inDays(19, 13, 30),
  setAt: '2026-09-08T09:00:00.000Z',
}

/** Google shows 4.3; 31 new reviews to 4.4, 212 to the goal of 4.5: no squares past 30. */
export const CARD_FAR_GOAL: RatingGoalCardView = {
  ...CARD,
  weekday: 2,
}

/** The cache already clears 4.1; Google still shows 4.0. */
export const CARD_LAGS: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  status: 'on_pace',
  exactAverage: 4.061,
  googleShowsSoon: true,
  forecast: { kind: 'earned' },
  next: null,
  stillNeeded: 0,
  nextUp: { targetTenths: 42, reviewsBeyondGoal: 82, days: { num: 82, den: 1 } },
}

/**
 * Google lags on a middle number (PLAN-D §2): it shows 4.3, the exact average
 * is 4.36 (500 reviews, 2,180 stars), so it should show 4.4 soon, and the card
 * counts the 180 new reviews to the goal of 4.5, never "0 to 4.4".
 */
export const CARD_LAGS_MIDDLE: RatingGoalCardView = {
  ...CARD,
  status: 'on_pace',
  targetTenths: 45,
  target: 4.5,
  qualityTenths: 47,
  quality: 4.7,
  paceTenthsPerWeek: 70,
  google: { ...HARBORLINE_GOOGLE, shows: 4.3, reviewCount: 500 },
  exactAverage: 4.36,
  qualityBasis: 'planned',
  forecastBasis: 'chosen_pace',
  forecast: {
    kind: 'days',
    central: { num: 180, den: 1 },
    fast: { num: 129 * 7000, den: 7700 },
    slow: { num: 270 * 7000, den: 6300 },
  },
  next: { targetTenths: 45, target: 4.5, reviewsNeeded: 180 },
  earnedTenths: 44,
  stillNeeded: 180,
  nextUp: null,
  baseline: { googleShows: 4.3, reviewCount: 480, exactAverage: 4.33 },
}

/** Ten reviews since the set average 3.75★: no time and no squares, the what-helps line. */
export const CARD_TOO_LOW: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  status: 'reviews_too_low',
  qualityBasis: 'since_set',
  forecast: { kind: 'unreachable' },
  next: null,
  stillNeeded: null,
  nextUp: null,
}

/** Google's numbers are two days old: the last number, dated, and why it waits. */
export const CARD_WAITING: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  status: 'waiting_for_google',
  google: { ...HARBORLINE_GOOGLE, current: false, asOf: '2026-10-12T08:00:00.000Z' },
}

/** Ten days in: a neutral chip, the same layout. */
export const CARD_GETTING_STARTED: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  status: 'getting_started',
  google: { ...HARBORLINE_GOOGLE, shows: 3.9 },
  next: { targetTenths: 40, target: 4, reviewsNeeded: 12 },
  stillNeeded: 70,
  forecast: inDays(70, 52, 98),
  setAt: '2026-10-04T09:00:00.000Z',
}

/** Set yesterday: the aim a day stands in for this week. */
export const CARD_HARBORLINE_JUST_SET: RatingGoalCardView = {
  ...CARD_GETTING_STARTED,
  justSet: true,
  thisWeekCount: 0,
  next: { targetTenths: 40, target: 4, reviewsNeeded: 19 },
  stillNeeded: 81,
  forecast: inDays(81, 60, 114),
  setAt: '2026-10-13T09:00:00.000Z',
}

/** No review in the last four weeks, five weeks in: no time to give. */
export const CARD_NO_PACE: RatingGoalCardView = {
  ...CARD_ACTUAL_PACE,
  status: 'below_pace',
  thisWeekCount: 0,
  lastFourWeeksPerWeek: 0,
  forecast: { kind: 'no_pace' },
  nextUp: null,
}

/** 0.1★ less than the average expected no longer reaches 4.1: the range is open. */
export const CARD_OPEN_SLOW: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  forecast: inDays(18, 13, null),
}

/** RepKey holds fewer reviews than Google counts: every count is "about", no squares. */
export const CARD_GOOGLE_SOURCE: RatingGoalCardView = {
  ...CARD_HARBORLINE,
  exactAverage: 4,
  exactAverageSource: 'google',
}
