// What the Languages section decides without a screen: which languages can be
// added, what a change does to the language set, and the words the section uses
// for coverage. Pure, so the wording and the rules are pinned by tests.

import {
  GUEST_LANGUAGE_PACKS,
  GUEST_LOCALES,
  GUEST_LOCALE_METADATA,
  OFFERED_GUEST_LOCALES,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import type {
  MissingPortalText,
  PortalLanguageCoverageRow,
} from '#/contexts/portal/application/public-api'

/** A Portal's languages: the fallback first, then the others in the order they were added. */
export type PortalLanguageSet = Readonly<{
  primary: GuestLocale
  additional: readonly GuestLocale[]
}>

export type PortalLanguageChange =
  | Readonly<{ kind: 'add'; locale: GuestLocale }>
  | Readonly<{ kind: 'remove'; locale: GuestLocale }>
  | Readonly<{ kind: 'make_fallback'; locale: GuestLocale }>

/** What the server accepts for a language change. */
export type OfferedPortalLanguageSet = Readonly<{
  primary: OfferedGuestLocale
  additional: readonly OfferedGuestLocale[]
}>

const isOffered = (locale: GuestLocale): locale is OfferedGuestLocale =>
  (OFFERED_GUEST_LOCALES as readonly GuestLocale[]).includes(locale)

// A language can be added when managers may offer it and its guest copy pack
// exists (generation 2, the pack the new guest page reads). There is no native
// speaker check in the closed beta (owner decision 5), so the pack is the gate.
const hasGuestCopyPack = (locale: GuestLocale): boolean =>
  GUEST_LANGUAGE_PACKS[locale].supported.some((pack) => pack.generation === 2)

const languagesOf = (set: PortalLanguageSet): GuestLocale[] => [
  set.primary,
  ...set.additional,
]

/** The languages the add menu offers: launch languages with a pack, not yet on the Portal. */
export function addableLanguages(set: PortalLanguageSet): OfferedGuestLocale[] {
  const present = languagesOf(set)
  return GUEST_LOCALES.filter(
    (locale): locale is OfferedGuestLocale =>
      isOffered(locale) && hasGuestCopyPack(locale) && !present.includes(locale),
  )
}

/** Whether the catalogue holds languages that cannot be added yet ("More languages later"). */
export const hasLaterLanguages = (): boolean =>
  GUEST_LOCALES.some((locale) => !isOffered(locale) || !hasGuestCopyPack(locale))

function asOfferedSet(set: PortalLanguageSet): OfferedPortalLanguageSet | null {
  if (!isOffered(set.primary) || !set.additional.every(isOffered)) return null
  return { primary: set.primary, additional: [...set.additional] as OfferedGuestLocale[] }
}

function nextSet(set: PortalLanguageSet, change: PortalLanguageChange) {
  const { locale } = change
  switch (change.kind) {
    case 'add':
      return addableLanguages(set).includes(locale as OfferedGuestLocale)
        ? { primary: set.primary, additional: [...set.additional, locale] }
        : null
    case 'remove':
      return set.additional.includes(locale)
        ? {
            primary: set.primary,
            additional: set.additional.filter((candidate) => candidate !== locale),
          }
        : null
    case 'make_fallback':
      return set.additional.includes(locale)
        ? {
            primary: locale,
            additional: [
              set.primary,
              ...set.additional.filter((candidate) => candidate !== locale),
            ],
          }
        : null
  }
}

/**
 * The language set after `change`, or null when the change does not apply (a
 * language already there, one that cannot be added, the fallback removed). The
 * fallback language is never removed: another language has to become the
 * fallback first.
 */
export function applyLanguageChange(
  set: PortalLanguageSet,
  change: PortalLanguageChange,
): OfferedPortalLanguageSet | null {
  const next = nextSet(set, change)
  return next === null ? null : asOfferedSet(next)
}

export function languageDisplayName(locale: GuestLocale): {
  native: string
  english: string
  chip: string
} {
  const metadata = GUEST_LOCALE_METADATA[locale]
  return {
    native: metadata.nativeName,
    english: metadata.englishName,
    chip: metadata.chipLabel,
  }
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

export type CoverageDescription = Readonly<{
  tone: 'complete' | 'missing'
  text: string
}>

export function describeCoverage(row: PortalLanguageCoverageRow): CoverageDescription {
  if (row.missing.length === 0) {
    return { tone: 'complete', text: `All ${plural(row.total, 'text', 'texts')}` }
  }
  return {
    tone: 'missing',
    text: `${row.present} of ${row.total} · ${row.missing.length} missing`,
  }
}

export function describeMissingText(text: MissingPortalText): string {
  switch (text.kind) {
    case 'title':
      return 'Title'
    case 'description':
      return 'Description'
    case 'link_label':
      return text.linkLabel === null ? 'Link label' : `Label for “${text.linkLabel}”`
  }
}

/** The editor section where a missing text is written. */
export function missingTextSection(text: MissingPortalText): 'welcome' | 'linktree' {
  return text.kind === 'link_label' ? 'linktree' : 'welcome'
}

/** What guests of a language see while it has gaps; null when there is nothing to say. */
export function describeFallbackEffect(
  row: PortalLanguageCoverageRow,
  fallbackLocale: GuestLocale,
): string | null {
  if (row.isFallback || row.missing.length === 0) return null
  const language = languageDisplayName(row.locale).english
  const fallback = languageDisplayName(fallbackLocale).english
  return `${language} guests see ${plural(row.missing.length, 'text', 'texts')} in ${fallback}`
}

export function summarizeLanguageCoverage(
  input: Readonly<{ languageCount: number; missingTotal: number }>,
): { text: string; attention: string | null } {
  return {
    text: plural(input.languageCount, 'language', 'languages'),
    attention: input.missingTotal > 0 ? `${input.missingTotal} missing` : null,
  }
}
