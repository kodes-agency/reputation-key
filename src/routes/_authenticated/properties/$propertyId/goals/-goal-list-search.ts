// What the Goals page reads from its address.
//
// `view` chooses the Active or the History tab. `result` is the monthly result
// a goal notice links to (notificationLink): the page opens that result's goal.
// Anyone can type an address, so a value the page does not know is dropped
// (a view it does not have opens the active goals) instead of failing the page.
import { z } from 'zod/v4'

export const goalListSearchSchema = z.object({
  view: z.enum(['active', 'history']).catch('active').default('active'),
  result: z.string().optional().catch(undefined),
})
