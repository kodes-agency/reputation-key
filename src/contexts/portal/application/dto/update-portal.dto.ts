// Portal context — update portal DTO

import { z } from 'zod/v4'

export const updatePortalInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(2, 'Must be at least 2 characters').max(64).optional(),
  description: z.string().max(500).nullable().optional(),
  theme: z
    .object({
      primaryColor: z.string(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
    })
    .optional(),
  smartRoutingEnabled: z.boolean().optional(),
  smartRoutingThreshold: z.number().int().min(1).max(4).optional(),
  isActive: z.boolean().optional(),
})

export type UpdatePortalInput = z.infer<typeof updatePortalInputSchema>
