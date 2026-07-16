// Property context — update property DTO

import { z } from 'zod/v4'

export const updatePropertyInputSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: z.string().min(1, 'This field is required').max(100).optional(),
  slug: z.string().min(2, 'Must be at least 2 characters').max(64).optional(),
  timezone: z.string().min(1, 'This field is required').optional(),
  gbpPlaceId: z.string().max(500, 'Must be 500 characters or less').nullable().optional(),
  /**
   * ISO 3166-1 alpha-2. Resolves processing region when currently unresolved.
   * Rejected when it would change an already-resolved region (BQR-3.5).
   */
  countryCode: z.string().length(2).optional(),
})

export type UpdatePropertyInput = z.infer<typeof updatePropertyInputSchema>
