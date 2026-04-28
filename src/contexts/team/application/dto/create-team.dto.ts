// Team context — DTO for creating a team

import { z } from 'zod/v4'

export const createTeamInputSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: z
    .string()
    .min(1, 'Team name is required')
    .max(100, 'Team name must be at most 100 characters'),
  description: z.string().max(500, 'Must be 500 characters or less').optional(),
  teamLeadId: z.string().min(1, 'This field is required').optional(),
})

export type CreateTeamInput = z.infer<typeof createTeamInputSchema>
