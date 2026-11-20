// Portal context — create portal group DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'

export const portalGroupNameSchema = z
  .string()
  .trim()
  .min(1, 'Group name is required')
  .max(100)

export const createPortalGroupInputSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: portalGroupNameSchema,
  portalIds: z.array(z.string().min(1)).optional(),
})

export type CreatePortalGroupInput = z.infer<typeof createPortalGroupInputSchema>
