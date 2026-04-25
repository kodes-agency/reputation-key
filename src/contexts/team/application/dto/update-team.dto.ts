// Team context — DTO for updating a team

import { z } from 'zod/v4'

export const updateTeamInputSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  teamLeadId: z.string().min(1).nullable().optional(),
})

export type UpdateTeamInput = z.infer<typeof updateTeamInputSchema>
