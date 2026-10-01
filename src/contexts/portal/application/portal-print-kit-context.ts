// Portal context — what a print is made of, from the Portal's working copy.
//
// The title of the Portal in each of its languages, the Property's look (the
// colours, the wordmark, the photo and the logo) and the languages the Portal
// offers. The preview on the Share tab and the PDF read this one function, so
// the card a manager sees is the card that prints.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import {
  brandProfileOf,
  type PortalPublicationSource,
} from '../domain/portal-publication-source'

export type PortalPrintKitLook = Readonly<{
  /** The brand set as text: the wordmark, else the Property's name. */
  wordmark: string
  accentColour: string
  fieldColour: string
  hero: Readonly<{ assetId: string; focalX: number; focalY: number }> | null
  logo: Readonly<{ assetId: string }> | null
}>

export type PortalPrintKitContext = Readonly<{
  portalName: string
  primaryLocale: GuestLocale
  /** The languages the Portal offers, the primary first. */
  locales: readonly GuestLocale[]
  /** The Portal's title in each language that has one written. */
  titles: Readonly<Partial<Record<GuestLocale, string>>>
  look: PortalPrintKitLook
}>

const written = (text: string | null | undefined): text is string =>
  text !== null && text !== undefined && text.trim() !== ''

export function buildPortalPrintKitContext(
  source: PortalPublicationSource,
): PortalPrintKitContext {
  const brand = brandProfileOf(source)
  const titles = Object.fromEntries(
    source.localeSet.flatMap((locale) => {
      const title = source.wording[locale]?.title
      return written(title) ? [[locale, title]] : []
    }),
  )
  return {
    portalName: source.portal.name,
    primaryLocale: source.primaryGuestLocale,
    locales: source.localeSet,
    titles,
    look: {
      wordmark: written(brand.wordmark) ? brand.wordmark.trim() : brand.displayName,
      accentColour: brand.accentColour,
      fieldColour: brand.fieldColour,
      hero: brand.hero
        ? {
            assetId: brand.hero.assetId,
            focalX: brand.hero.focalX,
            focalY: brand.hero.focalY,
          }
        : null,
      logo: brand.logo ? { assetId: brand.logo.assetId } : null,
    },
  }
}

/** What the browser is given: the same facts, with each image as a same-origin path. */
export type PortalPrintKitView = Readonly<{
  portalId: string
  portalName: string
  primaryLocale: GuestLocale
  locales: readonly GuestLocale[]
  titles: Readonly<Partial<Record<GuestLocale, string>>>
  look: Readonly<{
    wordmark: string
    accentColour: string
    fieldColour: string
    heroUrl: string | null
    heroFocal: Readonly<{ x: number; y: number }> | null
    logoUrl: string | null
  }>
}>

export function presentPortalPrintKit(
  portalId: string,
  context: PortalPrintKitContext,
): PortalPrintKitView {
  const { look } = context
  return {
    portalId,
    portalName: context.portalName,
    primaryLocale: context.primaryLocale,
    locales: context.locales,
    titles: context.titles,
    look: {
      wordmark: look.wordmark,
      accentColour: look.accentColour,
      fieldColour: look.fieldColour,
      heroUrl: look.hero ? portalMediaPublicPath(look.hero.assetId) : null,
      heroFocal: look.hero ? { x: look.hero.focalX, y: look.hero.focalY } : null,
      logoUrl: look.logo ? portalMediaPublicPath(look.logo.assetId) : null,
    },
  }
}
