// Portal context — update portal group DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'
import { portalGroupNameSchema } from './create-portal-group.dto'

export const updatePortalGroupInputSchema = z.object({
  portalGroupId: z.string().min(1, 'Portal Group ID is required'),
  name: portalGroupNameSchema.optional(),
})

export type UpdatePortalGroupInput = z.infer<typeof updatePortalGroupInputSchema>
