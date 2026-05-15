// Integration context — disconnect Google DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const disconnectGoogleInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
})

export type DisconnectGoogleInput = z.infer<typeof disconnectGoogleInputSchema>
