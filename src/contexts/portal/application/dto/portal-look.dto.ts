// Portal context — a Portal's own look (ADR 0070): what the three save server
// functions take, and how the settings read shows the Portal's own groups.
//
// Each save names one group and its mode. A value left out keeps the Portal's
// own, or is the Property's when the group becomes the Portal's, so "Set colours
// for this portal" sends the mode alone and changes nothing guests see, and the
// focal-point autosave and the photo dialog never overwrite each other.

import { z } from 'zod/v4'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { MAX_ADDITIONAL_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'
import type { PortalLookSources } from '../../domain/portal-look'
import { BACKGROUND_MODES, type BackgroundMode } from '../../domain/property-look'
import type { PropertyLookHero, PropertyLookLogo } from '../property-look-media'

const scope = {
  propertyId: z.string().min(1, 'Property ID is required'),
  portalId: z.string().min(1, 'Portal ID is required'),
}

const colourSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu, 'Choose a valid six-digit colour')
const assetIdSchema = z.uuid('Choose an uploaded image')
const focalSchema = z.number().min(0).max(1)
const inherit = z.object({ mode: z.literal('inherit') })

/** The accent and the background of one Portal, or back to the Property's. */
export const portalLookColoursInputSchema = z.object({
  ...scope,
  colours: z.discriminatedUnion('mode', [
    inherit,
    z.object({
      mode: z.literal('own'),
      accentColour: colourSchema.optional(),
      backgroundMode: z.enum(BACKGROUND_MODES).optional(),
      /** Kept in automatic mode too, as the Property's is. */
      backgroundColour: colourSchema.optional(),
    }),
  ]),
})

/** The wordmark and the logo of one Portal, or back to the Property's. */
export const portalLookIdentityInputSchema = z.object({
  ...scope,
  identity: z.discriminatedUnion('mode', [
    inherit,
    z.object({
      mode: z.literal('own'),
      /** The use case trims it and holds it to 24 characters; null shows the display name. */
      wordmark: z.string().max(200).nullable().optional(),
      /** An uploaded logo of the Property; null shows no logo. */
      logoAssetId: assetIdSchema.nullable().optional(),
    }),
  ]),
})

/**
 * A description per language of the Portal. The rule (at most 160 characters,
 * blank meaning none) is the use case's, so the bound here only keeps an absurd
 * body out; each language may be named once.
 */
const altTextsSchema = z
  .array(
    z.object({
      locale: offeredGuestLocaleSchema,
      text: z.string().max(2000).nullable(),
    }),
  )
  .max(MAX_ADDITIONAL_GUEST_LOCALES + 1)
  .refine(
    (texts) => new Set(texts.map(({ locale }) => locale)).size === texts.length,
    'A language was given more than once',
  )

/** One Portal's photo: the Property's, none, or its own. */
export const portalLookPhotoInputSchema = z.object({
  ...scope,
  photo: z.discriminatedUnion('mode', [
    inherit,
    z.object({ mode: z.literal('none') }),
    z.object({
      mode: z.literal('own'),
      /** An uploaded photo of the Property; left out, the Portal's own stays (or the Property's is copied). */
      heroAssetId: assetIdSchema.optional(),
      focalX: focalSchema.optional(),
      focalY: focalSchema.optional(),
      altTexts: altTextsSchema.optional(),
    }),
  ]),
})

export type PortalLookColoursInput = z.infer<typeof portalLookColoursInputSchema>
export type PortalLookIdentityInput = z.infer<typeof portalLookIdentityInputSchema>
export type PortalLookPhotoInput = z.infer<typeof portalLookPhotoInputSchema>

/** What a save answers: where the Portal's groups now come from and its look version. */
export type PortalLookSaved = Readonly<{
  portalId: string
  sources: PortalLookSources
  /** The Portal's effective look version after the save. */
  lookVersion: number
  /** Whether guests would see anything differently once the Portal is published. */
  changed: boolean
}>

export type PortalLookPhotoView =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{ mode: 'none' }>
  | Readonly<{
      mode: 'own'
      heroAssetId: string
      focalX: number
      focalY: number
      /** This photo's description per language; a language left out has none (decorative). */
      altTexts: Readonly<Partial<Record<GuestLocale, string>>>
      /**
       * The photo as a page draws it; null when it may no longer be served (taken
       * down), and the Portal then shows no photo.
       */
      hero: PropertyLookHero | null
    }>

export type PortalLookColoursView =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{
      mode: 'own'
      accentColour: string
      backgroundMode: BackgroundMode
      backgroundColour: string
    }>

export type PortalLookIdentityView =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{
      mode: 'own'
      /** Null shows the public display name. */
      wordmark: string | null
      logoAssetId: string | null
      /** The logo as a page draws it; null when there is none or it may no longer be served. */
      logo: PropertyLookLogo | null
    }>

/** One Portal's own look as its editor shows it. */
export type PortalLookView = Readonly<{
  sources: PortalLookSources
  /** The Portal's effective look version. */
  lookVersion: number
  photo: PortalLookPhotoView
  colours: PortalLookColoursView
  identity: PortalLookIdentityView
}>

/**
 * What the Portal settings read (`getPropertyPortalExperience`) adds for a
 * Portal's own look. The editor shows the own-look controls only while the
 * switch is on, to an Account Admin, for a Portal that is not archived, and once
 * the Property has two live Portals or this one already has a look of its own.
 */
export type PortalLookSettings = Readonly<{
  /** The Portal's own look; null when the read names no Portal or the Portal has no row. */
  portalLook: PortalLookView | null
  /** The Property's Portals that are neither archived nor deleted, the named one included. */
  siblingPortalCount: number
  /** PORTAL_OWN_LOOK_ENABLED: whether a Portal's own look may be changed at all. */
  portalLookEnabled: boolean
}>
