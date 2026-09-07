// Property context — create property DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'

const canonicalReplyLanguageSchema = z
  .string()
  .min(7)
  .max(35)
  .refine((value) => parseCanonicalReplyLanguageTag(value) !== null, {
    message: 'Choose a supported canonical reply language',
  })

export const createPropertyInputSchema = z
  .object({
    name: z.string().min(1, 'Property name is required').max(100),
    slug: z.string().min(2).max(64).optional(),
    timezone: z.string().min(1, 'Timezone is required'),
    defaultReplyLanguage: canonicalReplyLanguageSchema.optional(),
    /** ISO 3166-1 alpha-2 business location. */
    countryCode: z.string().length(2, 'Country is required'),
  })
  .strict()

export type CreatePropertyInput = z.infer<typeof createPropertyInputSchema>
