// The address that opens the Google rating goal wizard on arrival at the Goals
// page (`rating-goal-arrival.ts`). Constants only: the Properties list and the
// setup strip link with it, and the list is first paint.

/** The search value that asks the Goals page to open the wizard on arrival. */
export const RATING_GOAL_ARRIVAL = 'rating-goal'

/** A link's `search` into the Goals page, with the wizard opening on arrival. */
export const RATING_GOAL_ARRIVAL_SEARCH = { start: RATING_GOAL_ARRIVAL } as const
