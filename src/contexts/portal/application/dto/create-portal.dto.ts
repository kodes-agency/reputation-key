// Portal context — create portal DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'

export const createPortalInputSchema = z.object({
  name: z.string().min(1, 'Portal name is required').max(100),
  slug: z.string().min(2).max(64).optional(),
  description: z.string().max(500).optional(),
  propertyId: z.string().min(1, 'Property ID is required'),
  entityType: z.enum(['property', 'team', 'staff']).optional(),
  entityId: z.string().optional(),
  theme: z
    .object({
      primaryColor: z.string(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
    })
    .optional(),
  smartRoutingEnabled: z.boolean().optional(),
  smartRoutingThreshold: z.number().int().min(1).max(4).optional(),
})

export type CreatePortalInput = z.infer<typeof createPortalInputSchema>
