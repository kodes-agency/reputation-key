// What the New goal page reads from its address.
//
// `subject`: a group's page links here with the group already chosen
// (`?subject=portal_group:<id>`). `mode=several` opens the table that sets a
// goal for several portals at once, in place of the single goal form. Anyone
// can type an address, so a value the page does not know is dropped and the
// form opens as if it were not there.
import { z } from 'zod/v4'

export const newGoalSearchSchema = z.object({
  subject: z.string().max(100).optional().catch(undefined),
  mode: z.literal('several').optional().catch(undefined),
})
