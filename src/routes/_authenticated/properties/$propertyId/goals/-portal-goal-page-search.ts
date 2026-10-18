// What the Monthly portal goal's page reads from its address (PLAN PG-20).
//
// `add` opens "Add a portal goal" on a step: the choice, a goal for one portal,
// for each, for a group, or the average. `subject` names the Portal or group
// an old link chose (`portal:<id>`, `portal_group:<id>`); the page uses it only
// when it names one the sheet offers (`-goal-subject-prefill.ts`). Anyone can
// type an address, so a value the page does not know is dropped and the page
// opens as if it were not there.
import { z } from 'zod/v4'

export const portalGoalPageSearchSchema = z.object({
  add: z
    .enum(['choose', 'portal', 'each', 'group', 'average'])
    .optional()
    .catch(undefined),
  subject: z.string().max(100).optional().catch(undefined),
})
