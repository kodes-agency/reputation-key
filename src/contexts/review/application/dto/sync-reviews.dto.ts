// Review context — sync reviews DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Used by Phase 11 manual sync trigger server function.

import { z } from 'zod/v4'

export const syncReviewsInputSchema = z.object({
  propertyId: z.string().uuid('Invalid property ID'),
  connectionId: z.string().uuid('Invalid connection ID'),
  locationName: z.string().min(1, 'Location name is required'),
})

export type SyncReviewsInputDto = z.infer<typeof syncReviewsInputSchema>
