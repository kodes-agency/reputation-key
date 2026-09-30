// The guest-locale catalogue: the one home of which languages a guest can read
// a Portal in, which of them managers may offer today, and which reviewed
// language packs exist for each.
//
// Pure on purpose (no zod, no I/O) so domain code may import it; the zod
// schemas built from it live in `src/shared/guest-locale-schemas.ts`.

/** Every locale the guest surface can ever render, in display order. */
export const GUEST_LOCALES = Object.freeze(['en', 'es', 'it', 'fr', 'de', 'bg'] as const)
export type GuestLocale = (typeof GUEST_LOCALES)[number]

export type GuestLocaleMetadata = Readonly<{
  code: GuestLocale
  nativeName: string
  englishName: string
  /** The two-letter chip a language switcher shows: EN ES IT FR DE БГ. */
  chipLabel: string
  /** The tag handed to `Intl` when formatting dates and numbers. */
  intlTag: string
  script: 'Latn' | 'Cyrl'
}>

export const GUEST_LOCALE_METADATA: Readonly<Record<GuestLocale, GuestLocaleMetadata>> =
  Object.freeze({
    en: {
      code: 'en',
      nativeName: 'English',
      englishName: 'English',
      chipLabel: 'EN',
      intlTag: 'en',
      script: 'Latn',
    },
    es: {
      code: 'es',
      nativeName: 'Español',
      englishName: 'Spanish',
      chipLabel: 'ES',
      intlTag: 'es',
      script: 'Latn',
    },
    it: {
      code: 'it',
      nativeName: 'Italiano',
      englishName: 'Italian',
      chipLabel: 'IT',
      intlTag: 'it',
      script: 'Latn',
    },
    fr: {
      code: 'fr',
      nativeName: 'Français',
      englishName: 'French',
      chipLabel: 'FR',
      intlTag: 'fr',
      script: 'Latn',
    },
    de: {
      code: 'de',
      nativeName: 'Deutsch',
      englishName: 'German',
      chipLabel: 'DE',
      intlTag: 'de',
      script: 'Latn',
    },
    bg: {
      code: 'bg',
      nativeName: 'Български',
      englishName: 'Bulgarian',
      chipLabel: 'БГ',
      intlTag: 'bg-BG',
      script: 'Cyrl',
    },
  })

/**
 * Language packs per locale. `supported` is append-only forever: a snapshot
 * pins the pack it was published with and must verify for as long as it
 * exists. `generation` ties a pack to the snapshot schemas that may carry it
 * (1 for schema versions 1 and 2, 2 for the next). `current` is the pack a new
 * publication uses, or null while the locale has no reviewed pack.
 */
export const GUEST_LANGUAGE_PACKS = Object.freeze({
  en: { current: 'guest-ui-en-v1', supported: [{ id: 'guest-ui-en-v1', generation: 1 }] },
  bg: { current: 'guest-ui-bg-v1', supported: [{ id: 'guest-ui-bg-v1', generation: 1 }] },
  es: { current: null, supported: [] },
  it: { current: null, supported: [] },
  fr: { current: null, supported: [] },
  de: { current: null, supported: [] },
} as const satisfies Record<
  GuestLocale,
  {
    current: string | null
    supported: readonly { id: string; generation: 1 | 2 }[]
  }
>)

/** Every pack id ever supported, for any locale. */
export type GuestLanguagePackVersion =
  (typeof GUEST_LANGUAGE_PACKS)[GuestLocale]['supported'][number]['id']

/** The locales a manager may choose today: those with a reviewed current pack. */
export const OFFERED_GUEST_LOCALES = Object.freeze([
  'en',
  'bg',
] as const satisfies readonly GuestLocale[])
export type OfferedGuestLocale = (typeof OFFERED_GUEST_LOCALES)[number]

export function isGuestLocale(value: unknown): value is GuestLocale {
  return typeof value === 'string' && (GUEST_LOCALES as readonly string[]).includes(value)
}

/** The locale a stored or presented value names, or null. Never a silent default. */
export function parseGuestLocale(value: unknown): GuestLocale | null {
  return isGuestLocale(value) ? value : null
}

/** Maps a language tag such as `es-MX` or `DE-at` to its catalogue locale. */
export function matchGuestLocale(tag: string): GuestLocale | null {
  const primary = tag.trim().toLowerCase().split('-')[0]
  return parseGuestLocale(primary)
}

/** Whether `version` is a pack of `locale` that snapshots of `generation` may carry. */
export function isSupportedGuestLanguagePack(
  locale: GuestLocale,
  version: unknown,
  generation: 1 | 2,
): version is GuestLanguagePackVersion {
  if (typeof version !== 'string') return false
  const supported: readonly { id: string; generation: 1 | 2 }[] =
    GUEST_LANGUAGE_PACKS[locale].supported
  return supported.some((pack) => pack.id === version && pack.generation === generation)
}

/** The pack a new publication uses for `locale`, or null while none is reviewed. */
export function currentGuestLanguagePack(
  locale: GuestLocale,
): GuestLanguagePackVersion | null {
  return GUEST_LANGUAGE_PACKS[locale].current
}

export function guestLocaleFormatTag(locale: GuestLocale): string {
  return GUEST_LOCALE_METADATA[locale].intlTag
}
