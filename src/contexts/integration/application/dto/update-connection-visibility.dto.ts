// Integration context — update connection visibility DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const updateConnectionVisibilityInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
  visibility: z.enum(['private', 'organization']),
})

export type UpdateConnectionVisibilityInput = z.infer<
  typeof updateConnectionVisibilityInputSchema
>
