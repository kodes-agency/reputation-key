import { z } from 'zod/v4'

const uuid = z.uuid()

const goalProgramSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property'), propertyId: uuid }),
  z.object({ kind: z.literal('portal_group'), portalGroupId: uuid }),
  z.object({ kind: z.literal('portal'), portalId: uuid }),
])

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
