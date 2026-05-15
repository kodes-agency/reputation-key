// Integration context — import status DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const importStatusInputSchema = z.object({
  importId: z.string().min(1, 'Import ID is required'),
})

export type ImportStatusInput = z.infer<typeof importStatusInputSchema>
