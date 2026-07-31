// Integration context — connect Google DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const connectGoogleInputSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  visibility: z.enum(['private', 'organization']).default('private'),
  // BQC-7.6: the OAuth state nonce — the use case redeems the PKCE verifier
  // stored under it (one-time use, fail closed).
  stateNonce: z.string().min(1, 'OAuth state nonce is required'),
})

export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>
