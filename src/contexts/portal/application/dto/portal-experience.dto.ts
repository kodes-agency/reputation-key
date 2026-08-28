import { z } from 'zod/v4'
import { validatePortalDestinationUri } from '../../domain/approved-destination'
import { contrastRatio } from '../../domain/portal-experience'

export const portalGuestLocaleSchema = z.enum(['en', 'bg'])

const portalExperienceScopeSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  portalId: z.string().min(1, 'Portal ID is required').optional(),
})

export const propertyPortalExperienceInputSchema = portalExperienceScopeSchema

export const portalBrandDisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'Public display name is required')
  .max(120)

export const portalBrandColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu, 'Choose a valid six-digit colour')

export const portalBrandFormInputSchema = z
  .object({
    displayName: portalBrandDisplayNameSchema,
    primaryColor: portalBrandColorSchema,
    backgroundColor: portalBrandColorSchema,
    textColor: portalBrandColorSchema,
  })
  .superRefine((value, ctx) => {
    const primaryContrast = contrastRatio(value.primaryColor, value.backgroundColor)
    const textContrast = contrastRatio(value.textColor, value.backgroundColor)
    if (primaryContrast === null || textContrast === null || textContrast < 4.5) {
      ctx.addIssue({
        code: 'custom',
        path: ['textColor'],
        message: 'Text and background colours need accessible contrast',
      })
    }
  })

export const propertyPortalBrandProfileInputSchema = portalExperienceScopeSchema
  .extend({
    logoUrl: z.null().optional(),
    defaultHeroImageUrl: z.null().optional(),
  })
  .and(portalBrandFormInputSchema)

export const portalGuestTitleSchema = z
  .string()
  .trim()
  .min(1, 'Guest title is required')
  .max(120)

export const portalGuestDescriptionSchema = z
  .string()
  .trim()
  .min(1, 'Guest description is required')
  .max(500)

export const propertyPortalBrandContentInputSchema = portalExperienceScopeSchema.extend({
  locale: portalGuestLocaleSchema,
  title: portalGuestTitleSchema,
  shortDescription: portalGuestDescriptionSchema,
})

const portalLocalizedOverrideTitleDraftSchema = z
  .string()
  .trim()
  .max(120)
  .transform((value) => (value === '' ? null : value))

const portalLocalizedOverrideDescriptionDraftSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === '' ? null : value))

export const portalLocalizedOverrideFormInputSchema = z.object({
  title: portalLocalizedOverrideTitleDraftSchema,
  shortDescription: portalLocalizedOverrideDescriptionDraftSchema,
})

export const portalLocalizedOverrideInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  locale: portalGuestLocaleSchema,
  title: z.union([portalLocalizedOverrideTitleDraftSchema, z.null()]),
  shortDescription: z.union([portalLocalizedOverrideDescriptionDraftSchema, z.null()]),
  heroImageUrl: z.null().optional(),
})

export const portalApprovedDestinationListInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})

export const portalApprovedDestinationUriSchema = z
  .string()
  .trim()
  .min(1, 'HTTPS destination is required')
  .max(2_048)
  .refine((uri) => {
    try {
      validatePortalDestinationUri(uri)
      return true
    } catch {
      return false
    }
  }, 'Enter a public HTTPS address without credentials or a fragment')

export const portalApprovedDestinationRequestInputSchema =
  portalApprovedDestinationListInputSchema.extend({
    uri: portalApprovedDestinationUriSchema,
  })

export const portalApprovedDestinationDecisionInputSchema =
  portalApprovedDestinationListInputSchema.extend({
    destinationId: z.string().min(1, 'Destination ID is required'),
  })

export const portalApprovedDestinationDisableInputSchema =
  portalApprovedDestinationDecisionInputSchema.extend({
    reason: z.string().trim().min(1, 'Disable reason is required').max(240),
  })

export type PropertyPortalBrandProfileInput = z.infer<
  typeof propertyPortalBrandProfileInputSchema
>
export type PropertyPortalBrandContentInput = z.infer<
  typeof propertyPortalBrandContentInputSchema
>
export type PortalLocalizedOverrideInput = z.infer<
  typeof portalLocalizedOverrideInputSchema
>
