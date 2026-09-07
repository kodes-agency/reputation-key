// Property context — update property DTO

import { z } from 'zod/v4'
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'

const canonicalReplyLanguageSchema = z
  .string()
  .min(7)
  .max(35)
  .refine((value) => parseCanonicalReplyLanguageTag(value) !== null, {
    message: 'Choose a supported canonical reply language',
  })

export const updatePropertyInputSchema = z
  .object({
    propertyId: z.string().min(1, 'Property ID is required'),
    name: z.string().min(1, 'This field is required').max(100).optional(),
    slug: z.string().min(2, 'Must be at least 2 characters').max(64).optional(),
    timezone: z.string().min(1, 'This field is required').optional(),
    /** Null explicitly clears the tenant-confirmed reply-language preference. */
    defaultReplyLanguage: canonicalReplyLanguageSchema.nullable().optional(),
    /** ISO 3166-1 alpha-2 business location. */
    countryCode: z.string().length(2).optional(),
  })
  .strict()

export type UpdatePropertyInput = z.infer<typeof updatePropertyInputSchema>
