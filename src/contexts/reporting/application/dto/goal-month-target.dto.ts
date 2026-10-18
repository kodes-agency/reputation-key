// The command that changes a running month's target.
//
// Its own module, apart from goal-program.dto.ts, on purpose: that module is
// part of the first-paint bundle, and only a goal's own page changes a month's
// target. The two small rules it shares with the Program commands (the month
// key and the note) are restated here for the same reason. The measure's
// target rule is the command's: it depends on the version the month belongs to.
import { z } from 'zod/v4'

const uuid = z.uuid()

const monthKey = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)

/**
 * Change the target of the month `month` (`YYYY-MM`, the plan's `monthKey`)
 * from `expectedTarget` to `targetValue`. `expectedTarget`, `expectedVersion`
 * and `expectedFollowingMonth` (the plan's `followingMonthKey`, the month whose
 * first day the form named for the months after) are what the form showed;
 * the command refuses a goal that has moved on since. The measure's own target
 * rule is the command's to check: it depends on the version the month belongs to.
 */
export const changeGoalMonthTargetSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  month: monthKey,
  targetValue: z.number().finite('Enter a valid monthly target'),
  expectedTarget: z.number().finite(),
  expectedVersion: z.number().int().positive(),
  expectedFollowingMonth: monthKey,
  applyToFollowing: z.boolean(),
  // Optional, and stored with the change only when one was written.
  note: z.string().trim().max(500).optional(),
  // Where the new target came from (migration 0062); omitted, none is stored.
  // It records what the form said: nothing here checks it against a
  // recommendation.
  targetSource: z.enum(['recommended', 'own']).optional(),
})

export type ChangeGoalMonthTargetInput = z.infer<typeof changeGoalMonthTargetSchema>
