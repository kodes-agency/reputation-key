// The Google rating goal's detail page (round 5, PLAN-D D-2, mock D3) where
// Google's number moved both ways, and where the read found the goal reached
// or ended, for stories and tests: Harborline (rating-goal-detail.stories.fixtures.ts)
// with the chart and rows each state draws.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { DETAIL_HARBORLINE } from './rating-goal-detail.stories.fixtures'

const CHART = DETAIL_HARBORLINE.chart!

/**
 * The read found the goal reached: Google shows 4.1 and the exact average is
 * 4.07, above the goal's line. The read draws no likely band for a goal that
 * is no longer active; `next` and `nextUp` still come with the card.
 */
export const DETAIL_FOUND_REACHED: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  state: 'reached',
  status: 'reached',
  google: { ...DETAIL_HARBORLINE.google!, shows: 4.1 },
  exactAverage: 4.072,
  chart: {
    ...CHART,
    history: [...CHART.history!.slice(0, -1), { day: 0, thousandths: 4072 }],
    likely: [],
    today: 4072,
  },
  planSoFar: { ...DETAIL_HARBORLINE.planSoFar, reachedTenths: 41 },
}

/** The read found the goal ended (Google's location changed): no likely band. */
export const DETAIL_FOUND_ENDED: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  state: 'ended',
  endedReason: 'google_location_changed',
  chart: { ...CHART, likely: [] },
}

/**
 * Google showed 4.0 on 30 Sep and went back to 3.9 on 5 Oct (the exact average
 * hovering at 3.95, 3.948 today): the warn-coloured dot and row beside the
 * positive one. The band is left out; this fixture is for Google's two moves.
 */
export const DETAIL_WENT_BACK: RatingGoalDetailView = {
  ...DETAIL_HARBORLINE,
  google: { ...DETAIL_HARBORLINE.google!, shows: 3.9 },
  exactAverage: 3.948,
  next: { targetTenths: 40, target: 4, reviewsNeeded: 1 },
  chart: {
    ...CHART,
    history: [
      ...CHART.history!.slice(0, -4),
      { day: -16, thousandths: 3945 },
      { day: -9, thousandths: 3953 },
      { day: -2, thousandths: 3949 },
      { day: 0, thousandths: 3948 },
    ],
    likely: [],
    shownChanges: [
      { day: -14, tenths: 40, up: true },
      { day: -9, tenths: 39, up: false },
    ],
    today: 3948,
  },
  planSoFar: { ...DETAIL_HARBORLINE.planSoFar, reachedTenths: null },
  moved: {
    ...DETAIL_HARBORLINE.moved,
    shownChanges: [
      { at: '2026-10-05T07:00:00.000Z', tenths: 39, up: false },
      { at: '2026-09-30T07:00:00.000Z', tenths: 40, up: true },
    ],
  },
}
