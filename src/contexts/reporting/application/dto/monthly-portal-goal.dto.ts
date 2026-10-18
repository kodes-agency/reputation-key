// Monthly portal goal — the server functions' input schemas.
//
// A lazy module: only `server/monthly-portal-goals.ts` imports it, for
// `.validator(...)`, and that module is reached only by its own dynamic import,
// so nothing here reaches first paint (PLAN E10). Never imported by
// `goal-program.dto.ts`, which first paint loads.
import { z } from 'zod/v4'

/** A read of one Property's Monthly portal goal. */
export const monthlyPortalGoalPropertySchema = z.object({
  propertyId: z.uuid(),
})
