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

/** The card's Use (and the set sheet): one number, one measure, from one month. */
export const setMonthlyPortalGoalSchema = z.object({
  propertyId: z.uuid(),
  metric: z.enum(['portal_rating_count', 'qualified_scans']),
  targetValue: z.number().int().min(1).max(1_000_000),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  targetSource: z.enum(['recommended', 'own']),
})
