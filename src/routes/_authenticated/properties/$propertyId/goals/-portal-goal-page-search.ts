// URLs are untrusted: discard unknown add steps and validate subject prefill against
// the sheet's offered Portals and groups.

import { z } from 'zod/v4'

export const portalGoalPageSearchSchema = z.object({
  add: z
    .enum(['choose', 'portal', 'each', 'group', 'average'])
    .optional()
    .catch(undefined),
  subject: z.string().max(100).optional().catch(undefined),
})
