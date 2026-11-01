// The Google rating goal's detail page (2026-11-01, ADR 0067) as the detail read
// hands it over, for stories and tests: Harborline Suites twenty days after its goal
// of 4.1 at 1 a day and 4.5★ (the card of rating-goal-tracking.stories.fixtures.ts),
// with its charts, the pace before the goal and what moved it.
import type {
  RatingGoalChartPoint,
  RatingGoalChartView,
  RatingGoalDetailView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  CARD_ACTUAL_PACE,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_LAGS,
  CARD_LAGS_MIDDLE,
  CARD_TOO_LOW,
} from './rating-goal-tracking.stories.fixtures'

const line = (rows: readonly (readonly [day: number, thousandths: number])[]) =>
  rows.map(([day, thousandths]): RatingGoalChartPoint => ({ day, thousandths }))

/** A line for each tenth from `from` to `to`. */
const thresholds = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    tenths: from + i,
    thousandths: (from + i) * 100 - 50,
  }))

/** Today in the fixtures (FIXTURE_NOW), the Property's local day. */
const TODAY_KEY = '2026-10-14'

const HARBORLINE_CHART: RatingGoalChartView = {
  todayKey: TODAY_KEY,
  firstDay: -51,
  setDay: -20,
  // Flat before the set, then up a little more each week; 4.02 today.
  history: line([
    [-51, 3910],
    [-44, 3911],
    [-37, 3911],
    [-30, 3912],
    [-23, 3912],
    [-16, 3935],
    [-9, 3962],
    [-2, 4005],
    [0, 4020],
  ]),
  thresholds: thresholds(38, 42),
  shownChanges: [{ day: -6, tenths: 40, up: true }],
  today: 4020,
  // About 2 a month before the goal; 27 in the last 28 days.
  weeks: [
    { day: -51, count: 0 },
    { day: -44, count: 1 },
    { day: -37, count: 0 },
    { day: -30, count: 1 },
    { day: -23, count: 6 },
    { day: -16, count: 9 },
    { day: -9, count: 10 },
    { day: -2, count: 2 },
  ],
}

/** Harborline, twenty days in: on pace, 4.0 reached, 18 new reviews to 4.1. */
export const DETAIL_HARBORLINE: RatingGoalDetailView = {
  ...CARD_HARBORLINE,
  forecastAtChosenPace: CARD_HARBORLINE.forecast,
  forecastAtActualPace: CARD_ACTUAL_PACE.forecast,
  changes: [],
  plan: {
    targetTenths: 41,
    googleShowsTenths: 40,
    qualityTenths: 45,
    // 27 reviews beside the plan's 4.5★ counted as 15: 4.55★.
    sinceSet: { reviewCount: 27, average: 4.57, averageTenths: 46 },
    qualityBasis: 'blended',
    assumedAverage: 4.55,
    paceTenthsPerWeek: 70,
    lastFourWeeksPerWeek: 6.75,
    forecast: CARD_ACTUAL_PACE.forecast!,
  },
  chart: HARBORLINE_CHART,
  planSoFar: { prePlan: { perMonth: 2, trend: 'up' } },
  moved: {
    shownChanges: [{ at: '2026-10-08T07:00:00.000Z', tenths: 40, up: true }],
    setBy: 'user-ana',
    initialTargetTenths: 41,
    initialPaceTenthsPerWeek: 70,
    thisWeek: { count: 2, allStars: 5, averageTenths: 50 },
    lowReviews: [],
    lowSinceSet: 0,
  },
}

/** The pace went from 5 a week to 1 a day on 1 Oct. */
export const DETAIL_PLAN_CHANGED: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  changes: [
    {
      changedBy: 'user-ana',
      changedAt: '2026-10-01T08:00:00.000Z',
      field: 'pace',
      oldValue: '50',
      newValue: '70',
    },
  ],
  moved: { ...DETAIL_HARBORLINE.moved, initialPaceTenthsPerWeek: 50 },
}

/** RepKey holds fewer reviews than Google counts: the chart steps through Google's own numbers. */
export const DETAIL_GOOGLE_SOURCE: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_GOOGLE_SOURCE,
  chart: { ...HARBORLINE_CHART, history: null, today: null },
}

/** The same with a changed plan. */
export const DETAIL_CHANGED_PARTIAL: RatingGoalDetailView = {
  ...DETAIL_PLAN_CHANGED,
  ...CARD_GOOGLE_SOURCE,
  chart: { ...DETAIL_PLAN_CHANGED.chart!, history: null, today: null },
}

/**
 * A goal set 200 days ago (4.5 from 4.3 at 1.5 a day and 4.7★): a year of
 * history, no weeks before the goal to compare with.
 */
export const DETAIL_OLD_GOAL: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_LAGS_MIDDLE,
  status: 'below_pace',
  google: { ...CARD_LAGS_MIDDLE.google!, reviewCount: 1060 },
  // 4.34: Google shows 4.3, 45 new reviews to 4.4 and 450 to 4.5 at 4.62★.
  exactAverage: 4.34,
  earnedTenths: null,
  next: { targetTenths: 44, target: 4.4, reviewsNeeded: 45 },
  stillNeeded: 450,
  paceTenthsPerWeek: 105,
  forecastBasis: 'actual_pace',
  // 450 reviews at 1.5 a day, and at the 38 of the last 28 days.
  forecastAtChosenPace: {
    kind: 'days',
    central: { num: 450 * 70, den: 105 },
    fast: { num: 340 * 70 * 100, den: 105 * 110 },
    slow: null,
  },
  forecast: {
    kind: 'days',
    central: { num: 450 * 28, den: 38 },
    fast: { num: 340 * 28 * 100, den: 38 * 110 },
    slow: null,
  },
  nextUp: null,
  setAt: '2026-03-28T09:00:00.000Z',
  baseline: { googleShows: 4.3, reviewCount: 790, exactAverage: 4.29 },
  chart: {
    todayKey: TODAY_KEY,
    firstDay: -366,
    setDay: -200,
    // Flat for the first 23 weeks of the year shown, then up from the set.
    history: Array.from({ length: 53 }, (_, week) => ({
      day: week === 52 ? 0 : -366 + 7 * week,
      thousandths: week < 24 ? 4288 : 4288 + Math.round((week - 23) * 1.8),
    })),
    thresholds: thresholds(42, 46),
    shownChanges: [],
    today: 4340,
    // 38 reviews in the last 28 days.
    weeks: Array.from({ length: 53 }, (_, week) => ({
      day: -366 + 7 * week,
      count: week === 52 ? 3 : 8 + (week % 4),
    })),
  },
  plan: {
    ...DETAIL_HARBORLINE.plan!,
    targetTenths: 45,
    googleShowsTenths: 43,
    qualityTenths: 47,
    // 250 reviews summing 1,155 beside the plan's 4.7★ counted as 15: 4.62★.
    sinceSet: { reviewCount: 250, average: 4.62, averageTenths: 46 },
    assumedAverage: 4.623,
    paceTenthsPerWeek: 105,
    lastFourWeeksPerWeek: 9.5,
  },
  planSoFar: { prePlan: null },
  moved: { ...DETAIL_HARBORLINE.moved, shownChanges: [], initialTargetTenths: 45 },
}

/** New reviews too low for 4.1: no time to give, so no dotted line. */
export const DETAIL_TOO_LOW: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_TOO_LOW,
  chart: HARBORLINE_CHART,
  plan: {
    ...DETAIL_HARBORLINE.plan!,
    sinceSet: { reviewCount: 27, average: 3.81, averageTenths: 38 },
    qualityBasis: 'since_set',
    assumedAverage: 3.81,
  },
}

/** The cache clears 4.1, Google still shows 4.0: "Google should show 4.1 soon". */
export const DETAIL_LAGS: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_LAGS,
  chart: {
    ...HARBORLINE_CHART,
    history: [...HARBORLINE_CHART.history!.slice(0, -1), { day: 0, thousandths: 4061 }],
    today: 4061,
  },
}

/** Google lags on 4.4 (shows 4.3, exact 4.36): 180 new reviews to the goal of 4.5. */
export const DETAIL_LAGS_MIDDLE: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_LAGS_MIDDLE,
  chart: {
    ...HARBORLINE_CHART,
    history: line([
      [-51, 4328],
      [-30, 4330],
      [-16, 4339],
      [-9, 4348],
      [-2, 4357],
      [0, 4360],
    ]),
    thresholds: thresholds(42, 46),
    shownChanges: [],
    today: 4360,
  },
  planSoFar: { prePlan: { perMonth: 30, trend: 'same' } },
  moved: { ...DETAIL_HARBORLINE.moved, shownChanges: [], initialTargetTenths: 45 },
}
