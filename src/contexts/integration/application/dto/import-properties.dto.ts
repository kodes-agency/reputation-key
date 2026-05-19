// Integration context — import properties DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const importPropertiesInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
  locations: z
    .array(
      z.object({
        gbpPlaceId: z.string().min(1),
        businessName: z.string().min(1),
        address: z.string().nullable(),
        primaryCategory: z.string().nullable(),
        gbpLocationName: z.string().min(1),
      }),
    )
    .min(1, 'Select at least one location'),
})

export type ImportPropertiesInput = z.infer<typeof importPropertiesInputSchema>
