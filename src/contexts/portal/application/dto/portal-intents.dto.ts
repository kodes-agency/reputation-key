// Portal context — inputs of the Portal state intents

import { z } from 'zod/v4'
import { MAX_ADDITIONAL_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'

const portalIdField = z.string().min(1, 'Portal ID is required')

export const portalIdInputSchema = z.object({ portalId: portalIdField }).strict()
export type PortalIdInput = z.infer<typeof portalIdInputSchema>

/** Going live names the version the manager reviewed; the server refuses a draft that has moved. */
export const publishPortalInputSchema = z
  .object({
    portalId: portalIdField,
    reviewedDigest: z.string().min(1, 'The reviewed version is required'),
  })
  .strict()
export type PublishPortalInput = z.infer<typeof publishPortalInputSchema>

export const updatePortalSettingsInputSchema = z
  .object({
    portalId: portalIdField,
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    privateFeedbackThreshold: z.number().int().min(1).max(5).optional(),
    skipPrivateRating: z.boolean().optional(),
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
  })
  .strict()
export type UpdatePortalSettingsInput = z.infer<typeof updatePortalSettingsInputSchema>

export const changePortalSlugInputSchema = z
  .object({
    portalId: portalIdField,
    slug: z.string().min(2, 'Must be at least 2 characters').max(64),
  })
  .strict()
export type ChangePortalSlugInput = z.infer<typeof changePortalSlugInputSchema>

export const changePortalLanguagesInputSchema = z
  .object({
    portalId: portalIdField,
    primaryGuestLocale: offeredGuestLocaleSchema.optional(),
    additionalGuestLocales: z
      .array(offeredGuestLocaleSchema)
      // Bounded by the catalogue, not by what is offered today, so offering a
      // locale later needs no schema change. Excluding the primary locale is
      // enforced by the intent: a refinement here would break `.pick()` in
      // the edit form.
      .max(MAX_ADDITIONAL_GUEST_LOCALES)
      .refine((locales) => new Set(locales).size === locales.length, {
        message: 'Guest locales must be unique',
      })
      .optional(),
  })
  .strict()
export type ChangePortalLanguagesInput = z.infer<typeof changePortalLanguagesInputSchema>
