// Integration context — connect Google DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const connectGoogleInputSchema = z
  .object({
    code: z.string().min(1, 'Authorization code is required'),
    visibility: z.enum(['private', 'organization']).default('private'),
    purpose: z.enum(['reviews', 'import_gbp_v2', 'performance_reauth']),
    connectionMode: z.enum(['new', 'reauth', 'reconnect']),
    targetConnectionId: z.string().min(1).max(255).nullable(),
    verifierMaterial: z
      .object({
        contractVersion: z.literal('v2'),
        codeVerifier: z.string().min(43).max(128),
        oidcNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const targetIsValid =
      value.connectionMode === 'new'
        ? value.targetConnectionId === null
        : value.targetConnectionId !== null
    if (!targetIsValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetConnectionId'],
        message: 'OAuth connection mode and target are inconsistent',
      })
    }
  })

export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>
