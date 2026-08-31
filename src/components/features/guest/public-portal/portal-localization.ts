export type PortalLocale = 'en' | 'bg'
export type PortalLanguagePackVersion = 'guest-ui-en-v1' | 'guest-ui-bg-v1'

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
  const fallbackPack = selectedLocale === 'bg' ? 'guest-ui-bg-v1' : 'guest-ui-en-v1'
  return {
    selectedLocale,
    languagePackVersion: localization?.languagePackVersion ?? fallbackPack,
  }
}
