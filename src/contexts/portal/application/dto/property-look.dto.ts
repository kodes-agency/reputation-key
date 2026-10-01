import { z } from 'zod/v4'
import { MAX_ADDITIONAL_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'
import { BACKGROUND_MODES } from '../../domain/property-look'

const propertyIdSchema = z.string().min(1, 'Property ID is required')

const colourSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu, 'Choose a valid six-digit colour')

/** The accent, background and wordmark of the Property look (the page's autosave). */
export const propertyLookInputSchema = z.object({
  propertyId: propertyIdSchema,
  accentColour: colourSchema,
  backgroundMode: z.enum(BACKGROUND_MODES),
  /** Read only when the background is manual. */
  backgroundColour: colourSchema.optional(),
  /** The use case trims it and holds it to 24 characters; null clears it. */
  wordmark: z.string().max(200).nullable().optional(),
})

/** The languages a new Portal starts with: ordered, the first is its primary. */
export const propertyDefaultLocalesInputSchema = z.object({
  propertyId: propertyIdSchema,
  locales: z
    .array(offeredGuestLocaleSchema)
    .min(1, 'Choose at least one language')
    .max(MAX_ADDITIONAL_GUEST_LOCALES + 1),
})

const assetIdSchema = z.uuid('Choose an uploaded image')
const focalSchema = z.number().min(0).max(1)

/**
 * Put an uploaded photograph on the look, move where it is anchored, or take it
 * off (`assetId: null`). A description is kept per language; null clears one. The
 * use case holds a description to 160 characters, so the bound here only keeps an
 * absurd body out.
 */
export const propertyHeroInputSchema = z.object({
  propertyId: propertyIdSchema,
  assetId: assetIdSchema.nullable(),
  focalX: focalSchema.optional(),
  focalY: focalSchema.optional(),
  altTexts: z
    .array(
      z.object({
        locale: offeredGuestLocaleSchema,
        text: z.string().max(2000).nullable(),
      }),
    )
    .max(MAX_ADDITIONAL_GUEST_LOCALES + 1)
    .optional(),
})

/** Put an uploaded logo on the look, or take it off (`assetId: null`). */
export const propertyLogoInputSchema = z.object({
  propertyId: propertyIdSchema,
  assetId: assetIdSchema.nullable(),
})

export type PropertyLookInput = z.infer<typeof propertyLookInputSchema>
export type PropertyDefaultLocalesInput = z.infer<
  typeof propertyDefaultLocalesInputSchema
>
export type PropertyHeroInput = z.infer<typeof propertyHeroInputSchema>
export type PropertyLogoInput = z.infer<typeof propertyLogoInputSchema>
