import { z } from 'zod/v4'
import { GOAL_METRICS, MAX_GOAL_ASSIGNMENT_SELECTIONS } from '../../domain/goal-program'

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

/**
 * The note on a status change: optional. Without one no reason is recorded.
 */
const goalProgramReasonSchema = z.string().trim().max(500).optional()

const goalProgramSubjectSelectionSchema = z
  .array(goalProgramSubjectSchema)
  .min(1, 'Select at least one subject')
  .max(MAX_GOAL_ASSIGNMENT_SELECTIONS)

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

export const getGoalProgramHistorySchema = goalProgramIdentitySchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  after: z.object({ periodStart: z.coerce.date(), id: uuid }).optional(),
})

export const listGoalProgramsSchema = z.object({ propertyId: uuid })

/** The goals that target one subject, read live for the month so far. */
export const getGoalProgressSchema = z.object({
  propertyId: uuid,
  subject: goalProgramSubjectSchema,
})

export type CreateGoalProgramInput = z.infer<typeof createGoalProgramSchema>
