// Portal context — what a print is made of.
//
// The title of the Portal in each of its languages, the Property's look (the
// colours, the wordmark, the photo and the logo) and the languages the Portal
// offers. A print is permanent and its code opens the live version, so it is
// made of the live version: the languages it serves, the titles and the look it
// published. The preview on the Share tab and the PDF read the same functions,
// so the card a manager sees is the card that prints.
//
// A live version from before the Immersive Hub carries no look of its own the
// print can use; for one of those the working copy supplies the look and titles,
// but the languages are still the live version's.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  isLocalizedConfiguration,
  type ImmersivePortalPublicationConfiguration,
  type PortalPublicationConfiguration,
} from '../domain/portal-publication-snapshot'
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

/**
 * The title of each language, a language with none written reading the primary
 * language's, as the guest page does: the print never carries the Portal's
 * internal name where a guest reads a title.
 */
function titlesOf(
  locales: readonly GuestLocale[],
  titleOf: (locale: GuestLocale) => string | null | undefined,
): Readonly<Partial<Record<GuestLocale, string>>> {
  const primary = locales[0]
  const primaryTitle = primary === undefined ? undefined : titleOf(primary)
  return Object.fromEntries(
    locales.flatMap((locale) => {
      const title = titleOf(locale)
      if (written(title)) return [[locale, title]]
      return written(primaryTitle) ? [[locale, primaryTitle]] : []
    }),
  )
}

/**
 * The print from the working copy. `liveLocales`, when given, are the languages
 * the live version serves and in what order: the working copy may offer more,
 * but a print in a language the page does not have is a card nobody can fix.
 */
export function buildPortalPrintKitContext(
  source: PortalPublicationSource,
  liveLocales?: readonly GuestLocale[],
): PortalPrintKitContext {
  const brand = brandProfileOf(source)
  const locales = liveLocales ?? source.localeSet
  return {
    portalName: source.portal.name,
    primaryLocale: locales[0] ?? source.primaryGuestLocale,
    locales,
    titles: titlesOf(locales, (locale) => source.wording[locale]?.title),
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

/** The print from what the live Immersive Hub version published. */
export function printKitContextOfLive(
  portalName: string,
  configuration: ImmersivePortalPublicationConfiguration,
): PortalPrintKitContext {
  const { brandProfile: brand } = configuration
  return {
    portalName,
    primaryLocale: configuration.guestLocale,
    locales: configuration.localeSet,
    titles: titlesOf(
      configuration.localeSet,
      (locale) => configuration.localizedContent[locale]?.title.value,
    ),
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

export const isImmersiveConfiguration = (
  configuration: PortalPublicationConfiguration,
): configuration is ImmersivePortalPublicationConfiguration =>
  configuration.schemaVersion >= IMMERSIVE_HUB_SCHEMA_VERSION

/** The languages a live version serves, the primary first; a version 1 page is English only. */
export function liveLocalesOf(
  configuration: PortalPublicationConfiguration,
): readonly GuestLocale[] {
  return isLocalizedConfiguration(configuration) ? configuration.localeSet : ['en']
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
