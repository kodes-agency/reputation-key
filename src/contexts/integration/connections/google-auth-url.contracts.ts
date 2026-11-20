import { z } from 'zod/v4'

const newGoogleAuthorizationSchema = z
  .object({
    visibility: z.literal('organization').default('organization'),
    connectionMode: z.literal('new').default('new'),
    targetConnectionId: z.null().default(null),
  })
  .strict()

const reauthorizeGoogleAuthorizationSchema = z
  .object({
    visibility: z.literal('organization'),
    connectionMode: z.literal('reauth'),
    targetConnectionId: z.string().min(1).max(255),
  })
  .strict()

/**
 * Browser-callable Google ceremonies are deliberately narrow: start a new
 * Organization-owned connection, or reauthorize one exact retained row.
 */
export const googleAuthUrlInputSchema = z.union([
  newGoogleAuthorizationSchema,
  reauthorizeGoogleAuthorizationSchema,
])

export type GoogleAuthUrlInput = z.infer<typeof googleAuthUrlInputSchema>
