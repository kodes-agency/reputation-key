import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import { guestLocaleHref } from '../guest-locale-href'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

/** The pack key that names each locale in the pack's own language. */
const LANGUAGE_NAME_KEYS = {
  en: 'languageNameEn',
  bg: 'languageNameBg',
  es: 'languageNameEs',
  it: 'languageNameIt',
  fr: 'languageNameFr',
  de: 'languageNameDe',
} as const satisfies Record<GuestLocale, keyof GuestPortalCopyV2['copy']>

/** The texts of the language chip and sheet: a whole pack's copy satisfies it. */
export type LanguageSwitcherCopy = Readonly<
  Pick<
    GuestPortalCopyV2['copy'],
    | 'languageChipLabel'
    | 'languageSheetTitle'
    | 'languageSheetHint'
    | 'languageSheetClose'
    | 'languageCurrent'
    | (typeof LANGUAGE_NAME_KEYS)[GuestLocale]
  >
>

export type LanguageOption = Readonly<{
  locale: GuestLocale
  /** The language written in itself: the sheet's first line. */
  nativeName: string
  /** The language named in the page's language, or null when it reads the same. */
  secondaryName: string | null
  /** Where the row goes; none in the admin's preview, which has no token to build one from. */
  href: string | null
  isCurrent: boolean
}>

/** A portal offers a choice only when it has more than one language. */
export function offersLanguageChoice(locales: readonly GuestLocale[]): boolean {
  return locales.length > 1
}

/** The two-letter code on the chip: EN ES IT FR DE БГ. */
export function chipCode(locale: GuestLocale): string {
  return GUEST_LOCALE_METADATA[locale].chipLabel
}

/**
 * The chip's accessible name. It leads with the visible code, so a person who
 * says what they see ("click БГ") reaches it, then says what the control is.
 */
export function chipAccessibleName(
  selected: GuestLocale,
  copy: Pick<LanguageSwitcherCopy, 'languageChipLabel'>,
): string {
  return `${chipCode(selected)}, ${copy.languageChipLabel}: ${GUEST_LOCALE_METADATA[selected].nativeName}`
}

/** One row per language the portal offers, in the portal's own order. */
export function buildLanguageOptions(
  input: Readonly<{
    locales: readonly GuestLocale[]
    selectedLocale: GuestLocale
    token: string
    accessArtifactId: string | undefined
    copy: LanguageSwitcherCopy
  }>,
): readonly LanguageOption[] {
  return languageRows(input, (locale) =>
    guestLocaleHref(input.token, locale, input.accessArtifactId),
  )
}

/** The same rows for the admin's preview of the sheet: they name a language and go nowhere. */
export function previewLanguageOptions(
  input: Readonly<{
    locales: readonly GuestLocale[]
    selectedLocale: GuestLocale
    copy: LanguageSwitcherCopy
  }>,
): readonly LanguageOption[] {
  return languageRows(input, () => null)
}

function languageRows(
  input: Readonly<{
    locales: readonly GuestLocale[]
    selectedLocale: GuestLocale
    copy: LanguageSwitcherCopy
  }>,
  hrefFor: (locale: GuestLocale) => string | null,
): readonly LanguageOption[] {
  return input.locales.map((locale) => {
    const { nativeName } = GUEST_LOCALE_METADATA[locale]
    const inPageLanguage = input.copy[LANGUAGE_NAME_KEYS[locale]]
    return {
      locale,
      nativeName,
      secondaryName:
        inPageLanguage.toLocaleLowerCase() === nativeName.toLocaleLowerCase()
          ? null
          : inPageLanguage,
      href: hrefFor(locale),
      isCurrent: locale === input.selectedLocale,
    }
  })
}
