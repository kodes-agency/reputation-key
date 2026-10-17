// The Monday check-in's cards for the stories (round 5, PLAN-D D-3): Harborline
// at 1 a day, the card read on the Monday (and the Wednesday) after a week of 8
// new reviews against the plan's 7. The numbers are the card read's: the
// average is there only from ten reviews, the plan only when last week had one.
import type {
  RatingGoalCardView,
  RatingGoalRecapView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { CARD_HARBORLINE, CARD_TOO_LOW } from './rating-goal-tracking.stories.fixtures'

export const RECAP_HARBORLINE: RatingGoalRecapView = {
  weekStart: '2026-10-05',
  count: 8,
  averageTenths: null,
  plannedLastWeek: 7,
  raiseToTenths: 140,
  easeToTenths: 30,
}

const withRecap = (
  recap: Partial<RatingGoalRecapView>,
  card: Partial<RatingGoalCardView> = {},
): RatingGoalCardView => ({
  ...CARD_HARBORLINE,
  weekday: 1,
  thisWeekCount: 0,
  ...card,
  recap: { ...RECAP_HARBORLINE, ...recap },
})

/** The Monday: 8 new reviews last week, 1 more than the plan's 7. */
export const CARD_RECAP_MONDAY = withRecap({})
/** Still open on the Wednesday: nobody answered it yet. */
export const CARD_RECAP_WEDNESDAY = withRecap({}, { weekday: 3, thisWeekCount: 2 })
/** Twelve reviews at 4.6★: the average is named from ten. */
export const CARD_RECAP_AVERAGE = withRecap({ count: 12, averageTenths: 46 })
/** No new reviews last week. */
export const CARD_RECAP_ZERO = withRecap({ count: 0 }, { status: 'below_pace' })
/** The pace went to 2 a day last Thursday: getting started again, the count alone. */
export const CARD_RECAP_SPLIT = withRecap(
  { plannedLastWeek: null, raiseToTenths: 210, easeToTenths: 70 },
  { paceTenthsPerWeek: 140, status: 'getting_started' },
)
/** At 50 a day: nothing to raise to. */
export const CARD_RECAP_TOP = withRecap(
  {
    count: 330,
    averageTenths: 46,
    plannedLastWeek: 350,
    raiseToTenths: null,
    easeToTenths: 2100,
  },
  { paceTenthsPerWeek: 3500 },
)
/** At 1 a week: nothing to ease to. */
export const CARD_RECAP_ONE_A_WEEK = withRecap(
  { count: 1, plannedLastWeek: 1, raiseToTenths: 30, easeToTenths: null },
  { paceTenthsPerWeek: 10 },
)
/** At 2 a week: Ease reaches 1 a week. */
export const CARD_RECAP_TWO_A_WEEK = withRecap(
  { count: 1, plannedLastWeek: 2, raiseToTenths: 30, easeToTenths: 10 },
  { paceTenthsPerWeek: 20 },
)
/** Answered (kept, or the pace changed this week): the read carries none. */
export const CARD_RECAP_ANSWERED: RatingGoalCardView = {
  ...CARD_RECAP_MONDAY,
  recap: null,
}
/** New reviews too low: Raise or Ease does not answer that, so none is due. */
export const CARD_RECAP_TOO_LOW: RatingGoalCardView = {
  ...CARD_TOO_LOW,
  weekday: 1,
  recap: null,
}
