// The command that changes a running month's target.
//
// Its own module, apart from goal-program.dto.ts, on purpose: that module is
// part of the first-paint bundle, and only the goal's own page changes a
// month's target. The two small rules it shares with the Program commands (the
// month key and the note) are restated here for the same reason. The measure's
// target rule is not restated: the form below takes it from that module, which
// the page has loaded anyway.
import { z } from 'zod/v4'
import type { GoalMetric } from '../../domain/goal-program'
import { addTargetIssue } from './goal-program.dto'

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

/**
 * The dialog's form: the command's own fields, with the measure's target rule
 * said under the field before anything is sent. The measure is the running
 * month's, which the form does not choose, so it is the schema's and not a
 * field. A cleared number control reads as NaN, which is named as a target to
 * enter; the note is the text a field holds, empty when none was written.
 */
const formSchemaFor = (metric: GoalMetric) =>
  z
    .object({
      targetValue: z.number({ error: 'Enter a valid monthly target' }),
      applyToFollowing: changeGoalMonthTargetSchema.shape.applyToFollowing,
      note: z.string().trim().max(500),
    })
    .superRefine((input, context) =>
      addTargetIssue({ metric, targetValue: input.targetValue }, context),
    )

const formSchemas = new Map<GoalMetric, ReturnType<typeof formSchemaFor>>()

/** One schema per measure, the same object each time, so a form keeps its validator. */
export function changeGoalMonthTargetFormSchema(
  metric: GoalMetric,
): ReturnType<typeof formSchemaFor> {
  const known = formSchemas.get(metric)
  if (known) return known
  const built = formSchemaFor(metric)
  formSchemas.set(metric, built)
  return built
}

export type ChangeGoalMonthTargetFormInput = z.input<ReturnType<typeof formSchemaFor>>
