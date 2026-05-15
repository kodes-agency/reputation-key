// Integration context — list GBP locations DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const listLocationsInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
})

export type ListLocationsInput = z.infer<typeof listLocationsInputSchema>
