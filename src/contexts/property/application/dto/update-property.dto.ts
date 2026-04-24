// Property context — update property DTO

import { z } from 'zod/v4'

export const updatePropertyInputSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(2).max(64).optional(),
  timezone: z.string().min(1).optional(),
  gbpPlaceId: z.string().max(500).nullable().optional(),
})

export type UpdatePropertyInput = z.infer<typeof updatePropertyInputSchema>
