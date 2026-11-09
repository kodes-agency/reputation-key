// Anyone can type an address, so discard unknown values rather than failing the page.
// The view affects only Google goals. Consume start after answering it so reload does
// not reopen setup.

import { z } from 'zod/v4'
import { RATING_GOAL_ARRIVAL } from '#/contexts/reporting/rating-goals/ui/rating-goal-arrival-search'

export const goalListSearchSchema = z.object({
  view: z.enum(['active', 'history']).catch('active').default('active'),
  result: z.string().optional().catch(undefined),
  start: z.literal(RATING_GOAL_ARRIVAL).optional().catch(undefined),
})
