// What the Goals page reads from its address.
//
// `view` chooses the Active or the History tab. `result` is the monthly result
// a goal notice links to (notificationLink): the page opens that result's goal.
// `start` asks the page to open the Google rating goal wizard on arrival (the
// setup strip's step and the Properties list's "Set goal"); the page drops it
// from the address once it has answered, so a reload does not open it again.
// Anyone can type an address, so a value the page does not know is dropped
// (a view it does not have opens the active goals) instead of failing the page.
import { z } from 'zod/v4'
import { RATING_GOAL_ARRIVAL } from '#/components/goals/rating-goal-arrival-search'

export const goalListSearchSchema = z.object({
  view: z.enum(['active', 'history']).catch('active').default('active'),
  result: z.string().optional().catch(undefined),
  start: z.literal(RATING_GOAL_ARRIVAL).optional().catch(undefined),
})
