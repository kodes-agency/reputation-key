// The approved scenarios of the one-screen setup (E2/E4, PLAN-R4 §2), as the
// setup read hands them to the page, for the view-model's tests. Each is a
// Property the owner reviewed: the figures reproduce the approved canvas.
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'

type Figures = Partial<RatingGoalSetupInputs> &
  Pick<RatingGoalSetupInputs, 'reviewCount' | 'displayedTenths'>

/** Setup inputs from Google's count, the shown tenth and the cache's star sum. */
export const setupInputs = (figures: Figures, sum: number): RatingGoalSetupInputs => ({
  exact: { num: sum, den: figures.reviewCount },
  exactSource: 'cache',
  bestMonth: null,
  bestYear: null,
  reviewsLast90Days: 0,
  busiest30Days: 0,
  timezone: 'Europe/Sofia',
  asOf: '2026-10-16T12:00:00.000Z',
  ...figures,
})

/** Quiet hotel: 3.9 from 261, 2024 averaged 4.46, about 2 reviews a month. */
export const HARBORLINE = setupInputs(
  {
    reviewCount: 261,
    displayedTenths: 39,
    bestYear: { year: 2024, average: { num: 116, den: 26 }, reviewCount: 26 },
    reviewsLast90Days: 6,
    busiest30Days: 3,
  },
  1021,
)

/** Small B&B: 4.2 from 60, never asked. */
export const OLIVE_TREE = setupInputs(
  {
    reviewCount: 60,
    displayedTenths: 42,
    bestYear: { year: 2025, average: { num: 126, den: 30 }, reviewCount: 30 },
    reviewsLast90Days: 15,
    busiest30Days: 8,
  },
  251,
)

/** Busy hotel: 4.2 from 640, its best month August at 4.73. */
export const SEAVIEW = setupInputs(
  {
    reviewCount: 640,
    displayedTenths: 42,
    bestMonth: { year: 2026, month: 8, average: { num: 52, den: 11 }, reviewCount: 11 },
    reviewsLast90Days: 104,
    busiest30Days: 46,
  },
  2707,
)

/** Busy restaurant: 4.5 from 2,100, its best month May at 4.80. */
export const TAVOLA = setupInputs(
  {
    reviewCount: 2100,
    displayedTenths: 45,
    bestMonth: {
      year: 2026,
      month: 5,
      average: { num: 730, den: 152 },
      reviewCount: 152,
    },
    reviewsLast90Days: 444,
    busiest30Days: 152,
  },
  9492,
)

/** 4.6 from 500, nothing else known: only the next step up. */
export const EDGE_46 = setupInputs({ reviewCount: 500, displayedTenths: 46 }, 2300)

/** 4.7 from 500: Keep first, or raise it with a typed average (X1). */
export const EDGE_47 = setupInputs({ reviewCount: 500, displayedTenths: 47 }, 2350)

/** Google shows 3.9 while the complete cache averages 3.96 (D28). */
export const GOOGLE_LAGS = setupInputs(
  { reviewCount: 100, displayedTenths: 39, reviewsLast90Days: 10, busiest30Days: 6 },
  396,
)

/** 2.5 from 80: planned halfway, at 3.8★. */
export const LOW_RATING = setupInputs(
  { reviewCount: 80, displayedTenths: 25, reviewsLast90Days: 3, busiest30Days: 2 },
  200,
)
