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

const startMonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const numberSource = z.enum(['recommended', 'own'])

/**
 * "Add a portal goal" (PLAN PG-20): one Portal or Portal Group, counting
 * private ratings or scans, or the Property's average private rating. Whether
 * the subject suits the measure, and the number the measure, is the command's
 * to say; this is the transport shape.
 */
export const addPortalGoalSchema = z.object({
  propertyId: z.uuid(),
  subject: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('portal'), portalId: z.uuid() }),
    z.object({ kind: z.literal('portal_group'), portalGroupId: z.uuid() }),
    z.object({ kind: z.literal('property') }),
  ]),
  metric: z.enum(['portal_rating_count', 'qualified_scans', 'portal_rating_average']),
  targetValue: z.number().min(1).max(1_000_000),
  startMonth: startMonthKey,
  targetSource: numberSource,
})

/** "A goal for each portal": one row per ticked Portal, at most the 100 the sheet lists. */
export const addPortalGoalsSchema = z.object({
  propertyId: z.uuid(),
  metric: z.enum(['portal_rating_count', 'qualified_scans']),
  startMonth: startMonthKey,
  items: z
    .array(
      z.object({
        portalId: z.uuid(),
        targetValue: z.number().int().min(1).max(1_000_000),
        targetSource: numberSource,
      }),
    )
    .min(1)
    .max(100),
})
