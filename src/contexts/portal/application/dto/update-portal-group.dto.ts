// Portal context — update portal group DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'

export const updatePortalGroupInputSchema = z.object({
  portalGroupId: z.string().min(1, 'Portal Group ID is required'),
  name: z.string().min(1, 'Group name is required').max(100).optional(),
})

export type UpdatePortalGroupInput = z.infer<typeof updatePortalGroupInputSchema>
