import { z } from 'zod/v4'
import {
  GOAL_METRICS,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
  validateGoalTarget,
} from '../../domain/goal-program'

const uuid = z.uuid()

export const goalProgramMetricSchema = z.enum(GOAL_METRICS)

export const goalProgramSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property'), propertyId: uuid }),
  z.object({ kind: z.literal('portal_group'), portalGroupId: uuid }),
  z.object({ kind: z.literal('portal'), portalId: uuid }),
])

export const goalProgramReasonSchema = z
  .string()
  .trim()
  .min(1, 'Enter a reason for this change')
  .max(500, 'Keep the reason under 500 characters')

export const goalProgramSubjectSelectionSchema = z
  .array(goalProgramSubjectSchema)
  .min(1, 'Select at least one subject')
  .max(MAX_GOAL_ASSIGNMENT_SELECTIONS)

function addTargetIssue(
  input: Readonly<{
    metric: z.infer<typeof goalProgramMetricSchema>
    targetValue: number
  }>,
  context: z.RefinementCtx,
): void {
  const target = validateGoalTarget(input.metric, input.targetValue)
  if (target.ok) return
  const messages = {
    target_not_finite: 'Enter a valid monthly target',
    count_target_not_positive_integer: 'Use a positive whole number',
    average_target_out_of_range: 'Use a rating target from 1 to 5',
    average_target_precision: 'Use no more than one decimal place',
  } as const
  context.addIssue({
    code: 'custom',
    path: ['targetValue'],
    message: messages[target.reason],
  })
}

export const createGoalProgramSchema = z.object({
  propertyId: uuid,
  name: z.string().trim().min(1, 'Enter a goal name').max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  metric: goalProgramMetricSchema,
  targetValue: z.number().finite('Enter a valid monthly target'),
  subjects: goalProgramSubjectSelectionSchema,
})

export const reviseGoalProgramSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  metric: goalProgramMetricSchema,
  targetValue: z.number().finite('Enter a valid monthly target'),
  subjects: goalProgramSubjectSelectionSchema,
  reason: goalProgramReasonSchema,
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
  .omit({ propertyId: true, programId: true })
  .superRefine(addTargetIssue)

export const goalProgramAssignmentEditorSchema = z.object({
  subjects: z.array(goalProgramSubjectSchema).max(MAX_GOAL_ASSIGNMENT_SELECTIONS),
  selectAllCurrentPortals: z.boolean(),
  reason: goalProgramReasonSchema,
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

export const goalProgramIdentitySchema = z.object({
  propertyId: uuid,
  programId: uuid,
})

export const listGoalProgramsSchema = z.object({ propertyId: uuid })

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
