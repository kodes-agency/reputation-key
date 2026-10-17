// The Google rating goal's detail page of round 5 (PLAN-D D-2, mock D3) as the
// detail read hands it over, for stories and tests: Harborline Suites twenty
// days after its goal of 4.1 at 1 a day and 4.5★ (the card of
// rating-goal-tracking.stories.fixtures.ts), with the chart, the plan so far
// and what moved it. The cones and bands were worked out with the domain's own
// rules (rating-goal-climb.ts) from the numbers each fixture names; the read
// computes them. Points past both edges meeting the goal's line are left out.
import type {
  RatingGoalBandPoint,
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

type Row = readonly [day: number, low: number, high: number]

const band = (rows: readonly Row[]): RatingGoalBandPoint[] =>
  rows.map(([day, low, high]) => ({ day, low, high }))

const line = (rows: readonly (readonly [day: number, thousandths: number])[]) =>
  rows.map(([day, thousandths]): RatingGoalChartPoint => ({ day, thousandths }))

/** A line for each tenth from `from` to `to`. */
const thresholds = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    tenths: from + i,
    thousandths: (from + i) * 100 - 50,
  }))

/** 1 a day and 4.5★ from the set (261 reviews at 3.912), 20 days ago. */
const SET_CONE = band([
  [-20, 3912, 3912],
  [-13, 3924, 3932],
  [-6, 3934, 3950],
  [1, 3945, 3968],
  [8, 3955, 3985],
  [15, 3965, 4000],
  [22, 3974, 4015],
  [29, 3983, 4030],
  [36, 3991, 4043],
  [43, 3999, 4050],
  [57, 4014, 4050],
  [71, 4029, 4050],
  [85, 4042, 4050],
  [99, 4050, 4050],
])

/** From today (300 reviews at 4.02) at 4.55★ and 1 a day: the card's own arrival. */
const LIKELY = band([
  [0, 4020, 4020],
  [7, 4029, 4036],
  [14, 4037, 4050],
  [21, 4045, 4050],
  [28, 4050, 4050],
])

const HARBORLINE_CHART: RatingGoalChartView = {
  firstDay: -51,
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
  anchor: { day: -20, kind: 'set', paceTenthsPerWeek: 70, qualityTenths: 45 },
  plan: SET_CONE,
  likely: LIKELY,
  shownChanges: [{ day: -6, tenths: 40, up: true }],
  today: 4020,
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
    // 35 reviews summing 160 beside the plan's 4.5★ counted as 15: 4.55★.
    sinceSet: { reviewCount: 35, average: 4.571, averageTenths: 46 },
    qualityBasis: 'blended',
    assumedAverage: 4.55,
    paceTenthsPerWeek: 70,
    lastFourWeeksPerWeek: 6.75,
    forecast: CARD_ACTUAL_PACE.forecast!,
  },
  chart: HARBORLINE_CHART,
  planSoFar: { prePlan: { perMonth: 2, trend: 'up' }, reachedTenths: 40 },
  moved: {
    shownChanges: [{ at: '2026-10-08T07:00:00.000Z', tenths: 40, up: true }],
    setBy: 'user-ana',
    initialTargetTenths: 41,
    initialPaceTenthsPerWeek: 70,
    thisWeek: { count: 2, allStars: 5, averageTenths: 50 },
    lowReviews: [],
  },
}

/** The pace went from 5 a week to 1 a day on 1 Oct: the cone starts that Monday. */
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
  chart: {
    ...HARBORLINE_CHART,
    anchor: { day: -16, kind: 'changed', paceTenthsPerWeek: 70, qualityTenths: 45 },
    // From 275 reviews at 3.935 on Monday 28 Sep.
    plan: band([
      [-16, 3935, 3935],
      [-9, 3945, 3953],
      [-2, 3955, 3970],
      [5, 3965, 3987],
      [12, 3974, 4002],
      [19, 3983, 4017],
      [26, 3991, 4031],
      [33, 3999, 4044],
      [40, 4007, 4050],
      [54, 4022, 4050],
      [68, 4035, 4050],
      [89, 4050, 4050],
    ]),
  },
  moved: { ...DETAIL_HARBORLINE.moved, initialPaceTenthsPerWeek: 50 },
}

/** RepKey holds fewer reviews than Google counts: no line, the set's cone, "Today" alone. */
export const DETAIL_GOOGLE_SOURCE: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_GOOGLE_SOURCE,
  chart: { ...HARBORLINE_CHART, history: null, today: null },
}

/** The same with a changed plan: no history to start its cone from, so none. */
export const DETAIL_CHANGED_PARTIAL: RatingGoalDetailView = {
  ...DETAIL_PLAN_CHANGED,
  ...CARD_GOOGLE_SOURCE,
  chart: { ...DETAIL_PLAN_CHANGED.chart!, history: null, today: null, plan: [] },
}

/**
 * A goal set 200 days ago (4.5 from 4.3 at 1.5 a day and 4.7★): a year of
 * history, the cone to today, no weeks before the goal to compare with.
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
    firstDay: -366,
    // Flat for the first 23 weeks of the year shown, then up from the set.
    history: Array.from({ length: 53 }, (_, week) => ({
      day: week === 52 ? 0 : -366 + 7 * week,
      thousandths: week < 24 ? 4288 : 4288 + Math.round((week - 23) * 1.8),
    })),
    thresholds: thresholds(42, 46),
    anchor: { day: -200, kind: 'set', paceTenthsPerWeek: 105, qualityTenths: 47 },
    plan: band([
      [-200, 4290, 4290],
      [-179, 4301, 4311],
      [-158, 4311, 4331],
      [-137, 4320, 4349],
      [-116, 4329, 4366],
      [-95, 4337, 4382],
      [-74, 4345, 4396],
      [-53, 4352, 4410],
      [-32, 4359, 4422],
      [-11, 4366, 4434],
      [0, 4369, 4440],
    ]),
    // 38 reviews in the last 28 days, 4.62★: the slow end is open, a year.
    likely: band([
      [0, 4340, 4340],
      [42, 4348, 4361],
      [84, 4356, 4380],
      [126, 4363, 4397],
      [168, 4369, 4413],
      [210, 4375, 4427],
      [252, 4380, 4439],
      [294, 4385, 4450],
      [365, 4393, 4450],
    ]),
    shownChanges: [],
    today: 4340,
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
  planSoFar: { prePlan: null, reachedTenths: null },
  moved: { ...DETAIL_HARBORLINE.moved, shownChanges: [], initialTargetTenths: 45 },
}

/** New reviews too low for 4.1: the plan's cone, no likely band. */
export const DETAIL_TOO_LOW: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_TOO_LOW,
  chart: { ...HARBORLINE_CHART, likely: [] },
}

/** The cache clears 4.1, Google still shows 4.0: "Google should show 4.1 soon". */
export const DETAIL_LAGS: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_LAGS,
  chart: {
    ...HARBORLINE_CHART,
    history: [...HARBORLINE_CHART.history!.slice(0, -1), { day: 0, thousandths: 4061 }],
    likely: [],
    today: 4061,
  },
}

/** Google lags on 4.4 (shows 4.3, exact 4.36): 180 new reviews to the goal of 4.5. */
export const DETAIL_LAGS_MIDDLE: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  ...CARD_LAGS_MIDDLE,
  chart: {
    firstDay: -51,
    history: line([
      [-51, 4328],
      [-30, 4330],
      [-16, 4339],
      [-9, 4348],
      [-2, 4357],
      [0, 4360],
    ]),
    thresholds: thresholds(42, 46),
    anchor: { day: -20, kind: 'set', paceTenthsPerWeek: 70, qualityTenths: 47 },
    plan: band([
      [-20, 4330, 4330],
      [1, 4340, 4352],
      [22, 4350, 4371],
      [64, 4367, 4406],
      [106, 4382, 4435],
      [148, 4395, 4450],
      [162, 4399, 4450],
    ]),
    likely: band([
      [0, 4360, 4360],
      [42, 4377, 4397],
      [84, 4392, 4429],
      [126, 4404, 4450],
      [210, 4426, 4450],
      [294, 4443, 4450],
      [334, 4450, 4450],
    ]),
    shownChanges: [],
    today: 4360,
  },
  planSoFar: { prePlan: { perMonth: 30, trend: 'same' }, reachedTenths: null },
  moved: { ...DETAIL_HARBORLINE.moved, shownChanges: [], initialTargetTenths: 45 },
}
