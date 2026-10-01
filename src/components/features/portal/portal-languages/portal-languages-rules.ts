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

/**
 * What the rules read of the language registry: the catalogue, which languages
 * managers may offer, and which have a guest copy pack. Passed in so the rules
 * can be tested without depending on the packs that have shipped today.
 */
export type LanguageRegistry = Readonly<{
  locales: readonly GuestLocale[]
  isOffered: (locale: GuestLocale) => boolean
  hasGuestCopyPack: (locale: GuestLocale) => boolean
}>

const isOfferedLocale = (locale: GuestLocale): locale is OfferedGuestLocale =>
  (OFFERED_GUEST_LOCALES as readonly GuestLocale[]).includes(locale)

// A language can be added when managers may offer it and its guest copy pack
// exists (generation 2, the pack the new guest page reads). There is no native
// speaker check in the closed beta (owner decision 5), so the pack is the gate.
const LIVE_REGISTRY: LanguageRegistry = {
  locales: GUEST_LOCALES,
  isOffered: isOfferedLocale,
  hasGuestCopyPack: (locale) =>
    GUEST_LANGUAGE_PACKS[locale].supported.some((pack) => pack.generation === 2),
}

const languagesOf = (set: PortalLanguageSet): GuestLocale[] => [
  set.primary,
  ...set.additional,
]

/** The languages the add menu offers: launch languages with a pack, not yet on the Portal. */
export function addableLanguages(
  set: PortalLanguageSet,
  registry: LanguageRegistry = LIVE_REGISTRY,
): OfferedGuestLocale[] {
  const present = languagesOf(set)
  return registry.locales.filter(
    (locale): locale is OfferedGuestLocale =>
      registry.isOffered(locale) &&
      registry.hasGuestCopyPack(locale) &&
      !present.includes(locale),
  )
}

/** Whether the catalogue holds languages that cannot be added yet ("More languages later"). */
export const hasLaterLanguages = (registry: LanguageRegistry = LIVE_REGISTRY): boolean =>
  registry.locales.some(
    (locale) => !registry.isOffered(locale) || !registry.hasGuestCopyPack(locale),
  )

function asOfferedSet(set: PortalLanguageSet): OfferedPortalLanguageSet | null {
  if (!isOfferedLocale(set.primary) || !set.additional.every(isOfferedLocale)) {
    return null
  }
  return { primary: set.primary, additional: [...set.additional] as OfferedGuestLocale[] }
}

function nextSet(
  set: PortalLanguageSet,
  change: PortalLanguageChange,
  registry: LanguageRegistry,
) {
  const { locale } = change
  switch (change.kind) {
    case 'add':
      return addableLanguages(set, registry).includes(locale as OfferedGuestLocale)
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
  registry: LanguageRegistry = LIVE_REGISTRY,
): OfferedPortalLanguageSet | null {
  const next = nextSet(set, change, registry)
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

/**
 * What a manager does about a missing text. A title or description that blocks
 * publishing is missing because the Property has no wording for the language (an
 * override alone does not count), which an account admin writes; a link label is
 * written in the Linktree section.
 */
export type MissingTextAction =
  | Readonly<{ kind: 'write'; section: 'welcome' | 'linktree' }>
  | Readonly<{ kind: 'needs_property_wording' }>

export function missingTextAction(text: MissingPortalText): MissingTextAction {
  return text.blocksPublish
    ? { kind: 'needs_property_wording' }
    : { kind: 'write', section: missingTextSection(text) }
}

/**
 * What a language's gaps mean for publishing and for guests; null when there is
 * nothing to say. A missing title or description stops the Portal being
 * published (there is no fallback copy for them yet); a missing link label is
 * shown in the fallback language, which the fallback language itself has no
 * other language to do.
 */
export function describeFallbackEffect(
  row: PortalLanguageCoverageRow,
  fallbackLocale: GuestLocale,
): string | null {
  const blocking = row.missing.filter((text) => text.blocksPublish).length
  const labels = row.isFallback ? 0 : row.missing.length - blocking
  const language = languageDisplayName(row.locale).english
  const fallback = languageDisplayName(fallbackLocale).english
  const needs =
    blocking > 0
      ? `${language} is missing ${plural(blocking, 'text', 'texts')} that publishing needs`
      : null
  const shown =
    labels > 0
      ? `${needs === null ? `${language} guests` : 'its guests'} see ${plural(labels, 'link label', 'link labels')} in ${fallback}`
      : null
  return needs !== null && shown !== null ? `${needs}, and ${shown}` : (needs ?? shown)
}
