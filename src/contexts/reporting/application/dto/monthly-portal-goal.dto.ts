// Monthly portal goal — the server functions' input schemas.
//
// A lazy module: only `server/monthly-portal-goals.ts` imports it, for
// `.validator(...)`, and that module is reached only by its own dynamic import,
// so nothing here reaches first paint (PLAN E10). Never imported by
// `goal-program.dto.ts`, which first paint loads; the two rules it shares with
// the Program commands (the month key and the note) are restated here for that
// reason, as `goal-month-target.dto.ts` restates them.
import { z } from 'zod/v4'

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const measure = z.enum(['portal_rating_count', 'qualified_scans'])
/** A month's number: a whole number of private ratings or scans. */
const number = z.number().int().min(1).max(1_000_000)
const targetSource = z.enum(['recommended', 'own'])
// The manager's note on a change, as the Program commands bound it.
const note = z.string().trim().max(500).optional()

/** A read of one Property's Monthly portal goal. */
export const monthlyPortalGoalPropertySchema = z.object({
  propertyId: z.uuid(),
})

/** The card's Use (and the set sheet): one number, one measure, from one month. */
export const setMonthlyPortalGoalSchema = z.object({
  propertyId: z.uuid(),
  metric: measure,
  targetValue: number,
  startMonth: monthKey,
  targetSource,
})

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
  startMonth: monthKey,
  targetSource,
})

/** "A goal for each portal": one row per ticked Portal, at most the 100 the sheet lists. */
export const addPortalGoalsSchema = z.object({
  propertyId: z.uuid(),
  metric: z.enum(['portal_rating_count', 'qualified_scans']),
  startMonth: monthKey,
  items: z
    .array(
      z.object({
        portalId: z.uuid(),
        targetValue: z.number().int().min(1).max(1_000_000),
        targetSource,
      }),
    )
    .min(1)
    .max(100),
})

/** The goal a change or a stop is for. */
const ofTheGoal = { propertyId: z.uuid(), programId: z.uuid() }

/** "November, now": the running month's number, against what the sheet showed. */
export const changeMonthlyPortalGoalNowSchema = z.object({
  ...ofTheGoal,
  month: monthKey,
  targetValue: number,
  expectedTarget: z.number().finite(),
  expectedVersion: z.number().int().positive(),
  expectedFollowingMonth: monthKey,
  note,
  targetSource,
})

/** "From Dec 1" and "Count scans instead": the goal from the next month the sheet showed. */
export const reviseMonthlyPortalGoalSchema = z.object({
  ...ofTheGoal,
  metric: measure,
  targetValue: number,
  expectedVersion: z.number().int().positive(),
  startMonth: monthKey,
  note,
  targetSource,
})

/** Stop. */
export const stopMonthlyPortalGoalSchema = z.object(ofTheGoal)

/** The month-start check-in's Keep, for the month it asked about. */
export const keepMonthlyPortalGoalSchema = z.object({ ...ofTheGoal, month: monthKey })

/** The Overview prompt's "Not now", for the month it named. */
export const deferMonthlyPortalGoalPromptSchema = z.object({
  propertyId: z.uuid(),
  month: monthKey,
})

/** A Portal's Results line. */
export const monthlyPortalGoalLineSchema = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid(),
})
