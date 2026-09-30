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
 * Language packs per locale. `supported` is append-only forever, oldest first:
 * a snapshot pins the pack it was published with and must verify for as long
 * as it exists. `generation` ties a pack to the snapshot schemas that may
 * carry it (1 for schema versions 1 and 2, 2 for version 3). `current` is the
 * generation 1 pack a publication uses today, or null while the locale has no
 * reviewed pack; `currentGuestLanguagePack(locale, 2)` names the generation 2
 * pack, which only version 3 snapshots may carry.
 */
export const GUEST_LANGUAGE_PACKS = Object.freeze({
  en: {
    current: 'guest-ui-en-v1',
    supported: [
      { id: 'guest-ui-en-v1', generation: 1 },
      { id: 'guest-ui-en-v2', generation: 2 },
    ],
  },
  bg: {
    current: 'guest-ui-bg-v1',
    supported: [
      { id: 'guest-ui-bg-v1', generation: 1 },
      { id: 'guest-ui-bg-v2', generation: 2 },
    ],
  },
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

type SupportedGuestLanguagePack =
  (typeof GUEST_LANGUAGE_PACKS)[GuestLocale]['supported'][number]

/** Every pack id ever supported, for any locale. */
export type GuestLanguagePackVersion = SupportedGuestLanguagePack['id']
/** The packs schema versions 1 and 2 carry: function-based copy, frozen. */
export type GuestLanguagePackV1 = Extract<
  SupportedGuestLanguagePack,
  { generation: 1 }
>['id']
/** The packs a schema version 3 snapshot carries: template-based, JSON copy. */
export type GuestLanguagePackV2 = Extract<
  SupportedGuestLanguagePack,
  { generation: 2 }
>['id']

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

/**
 * The pack a new publication uses for `locale`, or null while none is
 * reviewed. Generation 1 (the default) is what every publication writes today;
 * generation 2 is the newest pack a version 3 snapshot may carry.
 */
export function currentGuestLanguagePack(
  locale: GuestLocale,
  generation?: 1,
): GuestLanguagePackV1 | null
export function currentGuestLanguagePack(
  locale: GuestLocale,
  generation: 2,
): GuestLanguagePackV2 | null
export function currentGuestLanguagePack(
  locale: GuestLocale,
  generation: 1 | 2 = 1,
): GuestLanguagePackVersion | null {
  const { current, supported } = GUEST_LANGUAGE_PACKS[locale]
  if (generation === 1) return current
  const packs: readonly { id: GuestLanguagePackVersion; generation: 1 | 2 }[] = supported
  return packs.filter((pack) => pack.generation === generation).at(-1)?.id ?? null
}

export function guestLocaleFormatTag(locale: GuestLocale): string {
  return GUEST_LOCALE_METADATA[locale].intlTag
}
