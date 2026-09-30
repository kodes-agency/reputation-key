import {
  currentGuestLanguagePack,
  type GuestLanguagePackVersion,
  type GuestLocale,
} from '#/shared/domain/guest-locale'

export type PortalLocale = GuestLocale
export type PortalLanguagePackVersion = GuestLanguagePackVersion

/** Public channel localization state, resolved once per render by the portal. */
export type PortalLocalization = Readonly<{
  selectedLocale: PortalLocale
  primaryLocale: PortalLocale
  availableLocales: readonly PortalLocale[]
  languagePackVersion?: PortalLanguagePackVersion
}>

export type ResolvedPortalLocale = Readonly<{
  selectedLocale: PortalLocale
  languagePackVersion: PortalLanguagePackVersion
}>

/**
 * Pick the guest locale and the language pack that must serve it. A portal
 * rendered without localization state falls back to the English pack.
 */
export function resolvePortalLocale(
  localization: PortalLocalization | undefined,
): ResolvedPortalLocale {
  const selectedLocale = localization?.selectedLocale ?? 'en'
  const languagePackVersion =
    localization?.languagePackVersion ?? currentGuestLanguagePack(selectedLocale)
  if (!languagePackVersion) {
    // The server never serves a locale that has no reviewed pack, so this is a
    // programming error, not a state to paper over with another language.
    throw new Error(`No guest language pack exists for locale ${selectedLocale}`)
  }
  return { selectedLocale, languagePackVersion }
}
