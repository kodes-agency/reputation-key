// More states of the Google rating goal's detail page (2026-11-01, ADR 0067), for
// stories and tests: Harborline (rating-goal-detail.stories.fixtures.ts) behind its
// plan, set yesterday, and as a goal to keep a number.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { DETAIL_HARBORLINE } from './rating-goal-detail.stories.fixtures'
import {
  CARD_HARBORLINE,
  CARD_HARBORLINE_JUST_SET,
} from './rating-goal-tracking.stories.fixtures'

const CHART = DETAIL_HARBORLINE.chart!

/**
 * The same goal behind its plan: 14 new reviews in the last four weeks (3.5 a week
 * against the plan's 7), 2 so far this week. The card works at that pace, so 4.1 is
 * 36 days away; at the chosen 1 a day it would be 18.
 */
export const DETAIL_BELOW_PACE: RatingGoalDetailView = (() => {
  const forecast = {
    kind: 'days',
    central: { num: 18 * 28, den: 14 },
    fast: { num: 15 * 28 * 100, den: 14 * 110 },
    slow: { num: 23 * 28 * 100, den: 14 * 90 },
  } as const
  return {
    ...DETAIL_HARBORLINE,
    status: 'below_pace',
    forecastBasis: 'actual_pace',
    forecast,
    forecastAtChosenPace: CARD_HARBORLINE.forecast,
    forecastAtActualPace: forecast,
    lastFourWeeksPerWeek: 3.5,
    chart: {
      ...CHART,
      weeks: [
        { day: -51, count: 0 },
        { day: -44, count: 1 },
        { day: -37, count: 0 },
        { day: -30, count: 1 },
        { day: -23, count: 3 },
        { day: -16, count: 5 },
        { day: -9, count: 4 },
        { day: -2, count: 2 },
      ],
    },
    plan: { ...DETAIL_HARBORLINE.plan!, lastFourWeeksPerWeek: 3.5, forecast },
  }
})()

/**
 * Set yesterday (Harborline at the set: 3.9 from 261 reviews, 19 new reviews to 4.0
 * and 81 to 4.1): Google has not moved, no review has come in since, and the aim a
 * day stands in for this week. The chart starts four weeks before the set's week.
 */
export const DETAIL_JUST_SET: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_HARBORLINE_JUST_SET,
  forecastAtChosenPace: CARD_HARBORLINE_JUST_SET.forecast,
  forecastAtActualPace: CARD_HARBORLINE_JUST_SET.forecast,
  lastFourWeeksPerWeek: 0.5,
  changes: [],
  plan: {
    ...DETAIL_HARBORLINE.plan!,
    googleShowsTenths: 39,
    sinceSet: { reviewCount: 0, average: null, averageTenths: null },
    qualityBasis: 'planned',
    assumedAverage: 4.5,
    lastFourWeeksPerWeek: 0.5,
    forecast: CARD_HARBORLINE_JUST_SET.forecast!,
  },
  chart: {
    todayKey: CHART.todayKey,
    firstDay: -30,
    setDay: -1,
    history: [
      { day: -30, thousandths: 3910 },
      { day: -23, thousandths: 3911 },
      { day: -16, thousandths: 3911 },
      { day: -9, thousandths: 3912 },
      { day: -2, thousandths: 3912 },
      { day: 0, thousandths: 3912 },
    ],
    thresholds: CHART.thresholds,
    shownChanges: [],
    today: 3912,
    // About 2 a month before the goal, and nothing since.
    weeks: [
      { day: -30, count: 1 },
      { day: -23, count: 0 },
      { day: -16, count: 1 },
      { day: -9, count: 0 },
      { day: -2, count: 0 },
    ],
  },
  planSoFar: { prePlan: { perMonth: 2, trend: 'same' } },
  moved: {
    ...DETAIL_HARBORLINE.moved,
    shownChanges: [],
    thisWeek: { count: 0, allStars: null, averageTenths: null },
    lowSinceSet: 0,
  },
}

/** A goal to keep a number: Google shows the 4.8 it was set to hold. No chart, no plan. */
export const DETAIL_KEEP: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  mode: 'keep',
  targetTenths: 48,
  target: 4.8,
  threshold: 4.75,
  google: { ...DETAIL_HARBORLINE.google!, shows: 4.8 },
  exactAverage: 4.812,
  qualityTenths: null,
  quality: null,
  qualityBasis: null,
  paceTenthsPerWeek: null,
  status: 'holding',
  next: null,
  stillNeeded: null,
  nextUp: null,
  forecast: null,
  forecastAtChosenPace: null,
  forecastAtActualPace: null,
  plan: null,
  chart: null,
  planSoFar: { prePlan: null },
  moved: {
    ...DETAIL_HARBORLINE.moved,
    initialTargetTenths: 48,
    initialPaceTenthsPerWeek: null,
    lowReviews: [],
    lowSinceSet: null,
  },
}
