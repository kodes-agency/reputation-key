import { z } from 'zod/v4'

export const createStaffParticipationInputSchema = z.object({
  propertyId: z.uuid(),
  displayName: z.string().trim().min(1, 'Enter the staff member’s name').max(255),
})

export const listStaffParticipationsInputSchema = z.object({
  propertyId: z.uuid().optional(),
  userId: z.string().min(1).max(255).optional(),
  activeOnly: z.boolean().optional().default(false),
})

export const archiveStaffParticipationInputSchema = z.object({
  staffParticipationId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  expectedRevision: z.number().int().positive(),
})

export const updatePortalResponsibilitiesInputSchema = z.object({
  staffParticipationId: z.uuid(),
  primaryPortalId: z.uuid().nullable(),
  supportingPortalIds: z.array(z.uuid()).max(500),
  expectedRevision: z.number().int().positive(),
})

export type CreateStaffParticipationInput = z.infer<
  typeof createStaffParticipationInputSchema
>
