// Integration context — connect Google DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const connectGoogleInputSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirectUri: z.string().url(),
  visibility: z.enum(['private', 'organization']).default('private'),
})

export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>
