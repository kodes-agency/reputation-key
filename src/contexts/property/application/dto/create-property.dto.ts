// Property context — create property DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const createPropertyInputSchema = z.object({
  name: z.string().min(1, 'Property name is required').max(100),
  slug: z.string().min(2).max(64).optional(),
  timezone: z.string().min(1, 'Timezone is required'),
  gbpPlaceId: z.string().max(500).optional(),
})

export type CreatePropertyInput = z.infer<typeof createPropertyInputSchema>
