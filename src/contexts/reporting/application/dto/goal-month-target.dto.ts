// The command that changes a running month's target.
//
// Its own module, apart from goal-program.dto.ts, on purpose: that module is
// part of the first-paint bundle, and only the goal's own page changes a
// month's target. The two small rules it shares with the Program commands (the
// month key and the note) are restated here for the same reason.
import { z } from 'zod/v4'

const uuid = z.uuid()

/**
 * Change the target of the month `month` (`YYYY-MM`, the plan's `monthKey`)
 * from `expectedTarget` to `targetValue`. `expectedTarget` and
 * `expectedVersion` are what the form showed; the command refuses a goal that
 * has moved on since. The measure's own target rule is the command's to check:
 * it depends on the version the month belongs to.
 */
export const changeGoalMonthTargetSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  targetValue: z.number().finite('Enter a valid monthly target'),
  expectedTarget: z.number().finite(),
  expectedVersion: z.number().int().positive(),
  applyToFollowing: z.boolean(),
  // Optional, and stored with the change only when one was written.
  note: z.string().trim().max(500).optional(),
})

export type ChangeGoalMonthTargetInput = z.infer<typeof changeGoalMonthTargetSchema>
