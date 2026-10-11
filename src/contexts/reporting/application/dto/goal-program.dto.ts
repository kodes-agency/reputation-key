import { z } from 'zod/v4'
import {
  GOAL_METRICS,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
  validateGoalTarget,
} from '../../domain/goal-program'

// Routes and components may import application, not domain: the start-month
// helpers the new-goal form shares with the create command. They are
// re-exported, not used here, so their calendar code loads with the form and
// stays out of the first-paint bundle this module is part of.
export { defaultGoalStartMonth, goalStartOptions } from '../../domain/goal-start'

const uuid = z.uuid()

/**
 * `YYYY-MM` on the Property's calendar. The command decides whether it is still
 * a choice. No message of its own: the form offers the two months, so a
 * malformed key is a client fault, and this module ships in first paint.
 */
const goalStartMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)

const goalProgramMetricSchema = z.enum(GOAL_METRICS)

const goalProgramSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property'), propertyId: uuid }),
  z.object({ kind: z.literal('portal_group'), portalGroupId: uuid }),
  z.object({ kind: z.literal('portal'), portalId: uuid }),
])

// A manager's note on a change, as a form holds it: a text field always has a
// string, and an empty one means no note.
const goalProgramNoteFieldSchema = z.string().trim().max(500)

/**
 * The note on a command: optional. Without one a version records a default
 * (`revised`, `subjects_changed`) and a status change records nothing.
 */
const goalProgramReasonSchema = goalProgramNoteFieldSchema.optional()

const goalProgramSubjectSelectionSchema = z
  .array(goalProgramSubjectSchema)
  .min(1, 'Select at least one subject')
  .max(MAX_GOAL_ASSIGNMENT_SELECTIONS)

const TARGET_FAULTS = {
  target_not_finite: 'Enter a valid monthly target',
  count_target_not_positive_integer: 'Use a positive whole number',
  average_target_out_of_range: 'Use a rating target from 1 to 5',
  average_target_precision: 'Use no more than one decimal place',
} as const

/**
 * What is wrong with a target for its measure, in the words a form prints
 * under the field; null when the measure takes it. One spelling for the single
 * goal form and for each row of the table that sets several goals.
 */
export function goalTargetFault(
  metric: z.infer<typeof goalProgramMetricSchema>,
  targetValue: number,
): string | null {
  const target = validateGoalTarget(metric, targetValue)
  return target.ok ? null : TARGET_FAULTS[target.reason]
}

function addTargetIssue(
  input: Readonly<{
    metric: z.infer<typeof goalProgramMetricSchema>
    targetValue: number
  }>,
  context: z.RefinementCtx,
): void {
  const message = goalTargetFault(input.metric, input.targetValue)
  if (message !== null) {
    context.addIssue({ code: 'custom', path: ['targetValue'], message })
  }
}

export const createGoalProgramSchema = z.object({
  propertyId: uuid,
  name: z.string().trim().min(1, 'Enter a goal name').max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  metric: goalProgramMetricSchema,
  targetValue: z.number().finite('Enter a valid monthly target'),
  subjects: goalProgramSubjectSelectionSchema,
  // Omitted keeps the first full month that has not begun, as before the
  // month could be chosen.
  startMonth: goalStartMonthSchema.optional(),
})

export const reviseGoalProgramSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  metric: goalProgramMetricSchema,
  targetValue: z.number().finite('Enter a valid monthly target'),
  subjects: goalProgramSubjectSelectionSchema,
  reason: goalProgramReasonSchema,
  // The version the form was opened on. A form that sends it is refused once
  // the goal has changed under it.
  expectedVersion: z.number().int().positive().optional(),
})

// Interactive forms use the same command fields, with the domain target rule
// surfaced before submission. The server command DTO deliberately stays a
// transport-shape validator; the use case remains the final domain authority.
export const createGoalProgramFormSchema = z
  .object({
    name: createGoalProgramSchema.shape.name,
    description: z.string().trim().max(2_000),
    metric: createGoalProgramSchema.shape.metric,
    targetValue: createGoalProgramSchema.shape.targetValue,
    subjects: createGoalProgramSchema.shape.subjects,
  })
  .superRefine(addTargetIssue)

export const reviseGoalProgramFormSchema = reviseGoalProgramSchema
  .omit({ propertyId: true, programId: true, expectedVersion: true })
  .extend({ reason: goalProgramNoteFieldSchema })
  .superRefine(addTargetIssue)

export const goalProgramAssignmentEditorSchema = z.object({
  subjects: z.array(goalProgramSubjectSchema).max(MAX_GOAL_ASSIGNMENT_SELECTIONS),
  selectAllCurrentPortals: z.boolean(),
  reason: goalProgramNoteFieldSchema,
})

export const changeGoalProgramAssignmentsSchema = z
  .object({
    propertyId: uuid,
    programId: uuid,
    expectedVersion: z.number().int().positive(),
    add: z
      .array(goalProgramSubjectSchema)
      .max(MAX_GOAL_ASSIGNMENT_SELECTIONS)
      .default([]),
    remove: z
      .array(goalProgramSubjectSchema)
      .max(MAX_GOAL_ASSIGNMENT_SELECTIONS)
      .default([]),
    selectAllCurrentPortals: z.boolean().default(false),
    reason: goalProgramReasonSchema,
  })
  .superRefine((input, context) => {
    if (input.add.length + input.remove.length > MAX_GOAL_ASSIGNMENT_SELECTIONS) {
      context.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: MAX_GOAL_ASSIGNMENT_SELECTIONS,
        inclusive: true,
        path: ['add'],
        message: `At most ${MAX_GOAL_ASSIGNMENT_SELECTIONS} explicit selections are allowed`,
      })
    }
    if (
      input.add.length === 0 &&
      input.remove.length === 0 &&
      !input.selectAllCurrentPortals
    ) {
      context.addIssue({
        code: 'custom',
        path: ['add'],
        message: 'Select at least one assignment change',
      })
    }
  })

export const changeGoalProgramStatusSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  status: z.enum(['scheduled', 'active', 'paused', 'ended']),
  reason: goalProgramReasonSchema,
})

/** A goal's name and description, changed in place. No version is written. */
export const renameGoalProgramSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  name: createGoalProgramSchema.shape.name,
  // Omitted keeps the description the goal has; null or empty clears it.
  description: createGoalProgramSchema.shape.description,
})

export const goalProgramIdentitySchema = z.object({
  propertyId: uuid,
  programId: uuid,
})

export const listGoalProgramsSchema = z.object({ propertyId: uuid })

/** The goals that target one subject, read live for the month so far. */
export const getGoalProgressSchema = z.object({
  propertyId: uuid,
  subject: goalProgramSubjectSchema,
})

/** The month so far for one subject and measure, read before a goal exists. */
export const previewGoalMonthSchema = z.object({
  propertyId: uuid,
  metric: goalProgramMetricSchema,
  subject: goalProgramSubjectSchema,
})

export type CreateGoalProgramInput = z.infer<typeof createGoalProgramSchema>
export type ReviseGoalProgramInput = z.infer<typeof reviseGoalProgramSchema>
export type CreateGoalProgramFormInput = z.input<typeof createGoalProgramFormSchema>
export type ReviseGoalProgramFormInput = z.input<typeof reviseGoalProgramFormSchema>
export type GoalProgramAssignmentEditorInput = z.input<
  typeof goalProgramAssignmentEditorSchema
>
export type ChangeGoalProgramAssignmentsInput = z.infer<
  typeof changeGoalProgramAssignmentsSchema
>
