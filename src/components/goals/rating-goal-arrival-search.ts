// Keep arrival links in a constants-only module: the Properties list is first-paint
// code.

/** The search value that asks the Goals page to open the wizard on arrival. */
export const RATING_GOAL_ARRIVAL = 'rating-goal'

/** A link's `search` into the Goals page, with the wizard opening on arrival. */
export const RATING_GOAL_ARRIVAL_SEARCH = { start: RATING_GOAL_ARRIVAL } as const
