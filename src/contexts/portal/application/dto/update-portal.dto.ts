// Portal context — update portal DTO

import { z } from 'zod/v4'
import { MAX_ADDITIONAL_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'

export const updatePortalInputSchema = z
  .object({
    portalId: z.string().min(1, 'Portal ID is required'),
    name: z.string().min(1).max(100).optional(),
    slug: z.string().min(2, 'Must be at least 2 characters').max(64).optional(),
    description: z.string().max(500).nullable().optional(),
    privateFeedbackThreshold: z.number().int().min(1).max(5).optional(),
    // Only removal is client-controlled. Non-null URLs are published solely by
    // the issuance-bound derivative worker.
    heroImageUrl: z.null().optional(),
    theme: z
      .object({
        primaryColor: z.string(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
      })
      .optional(),
    publicationState: z.enum(['draft', 'published', 'disabled', 'archived']).optional(),
    primaryGuestLocale: offeredGuestLocaleSchema.optional(),
    additionalGuestLocales: z
      .array(offeredGuestLocaleSchema)
      // Bounded by the catalogue, not by what is offered today, so offering a
      // locale later needs no schema change. Excluding the primary locale is
      // enforced by the use case: a refinement here would break `.pick()` in
      // the edit form.
      .max(MAX_ADDITIONAL_GUEST_LOCALES)
      .refine((locales) => new Set(locales).size === locales.length, {
        message: 'Guest locales must be unique',
      })
      .optional(),
  })
  .strict()

export type UpdatePortalInput = z.infer<typeof updatePortalInputSchema>
