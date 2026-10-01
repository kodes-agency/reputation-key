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
 * carry it (1 for schema versions 1 and 2, 2 for version 3).
 *
 * Publishing writes schema version 3 only (round 4, slice 19), so the pack a
 * publication uses is `currentGuestLanguagePack(locale, 2)`: the newest
 * generation 2 pack, or null while the locale has none (it cannot be
 * published). `current` is the generation 1 pack the legacy guest page falls
 * back to for a snapshot that names none; it is frozen with the packs it names
 * and no longer says anything about what a publication uses.
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
  // es, it, fr and de never had a legacy page, so they have a generation 2
  // pack only: `current`, the generation 1 pack the legacy page falls back to,
  // stays null for them for good.
  es: { current: null, supported: [{ id: 'guest-ui-es-v2', generation: 2 }] },
  it: { current: null, supported: [{ id: 'guest-ui-it-v2', generation: 2 }] },
  fr: { current: null, supported: [{ id: 'guest-ui-fr-v2', generation: 2 }] },
  de: { current: null, supported: [{ id: 'guest-ui-de-v2', generation: 2 }] },
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

/**
 * The locales a manager may choose today: every catalogue locale, each with a
 * generation 2 pack in `GUEST_LANGUAGE_PACKS`. During the closed beta a language
 * is offered as soon as its pack is drafted, with no native-speaker check
 * (owner decision 5, 2026-09-30), so a locale joins this list in the change
 * that registers its pack.
 */
export const OFFERED_GUEST_LOCALES = Object.freeze([
  'en',
  'es',
  'it',
  'fr',
  'de',
  'bg',
] as const satisfies readonly GuestLocale[])
export type OfferedGuestLocale = (typeof OFFERED_GUEST_LOCALES)[number]

/** Whether a manager may choose `value` today: a catalogue locale with a pack. */
export function isOfferedGuestLocale(value: unknown): value is OfferedGuestLocale {
  return (
    typeof value === 'string' &&
    (OFFERED_GUEST_LOCALES as readonly string[]).includes(value)
  )
}

/** A Portal offers its primary locale plus at most this many more. */
export const MAX_ADDITIONAL_GUEST_LOCALES = GUEST_LOCALES.length - 1

export function isGuestLocale(value: unknown): value is GuestLocale {
  return typeof value === 'string' && (GUEST_LOCALES as readonly string[]).includes(value)
}

/** The locale a stored or presented value names, or null. Never a silent default. */
export function parseGuestLocale(value: unknown): GuestLocale | null {
  return isGuestLocale(value) ? value : null
}

/**
 * Whether `additional` can sit beside `primary` in a Portal's locale set: only
 * catalogue locales, none twice, none equal to the primary, and no more than
 * the catalogue leaves room for.
 */
export function isValidAdditionalGuestLocales(
  primary: GuestLocale,
  additional: readonly unknown[],
): additional is readonly GuestLocale[] {
  return (
    additional.length <= MAX_ADDITIONAL_GUEST_LOCALES &&
    additional.every(isGuestLocale) &&
    new Set(additional).size === additional.length &&
    !additional.includes(primary)
  )
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
 * The newest pack of `locale` in a generation, or null while there is none.
 * Generation 2 is what a new publication writes (and the newest pack a version
 * 3 snapshot may carry); generation 1, the default, is the frozen pack the
 * legacy page falls back to.
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
