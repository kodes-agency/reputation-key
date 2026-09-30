// Completeness of a schema version 3 (Immersive Hub) publication configuration.
//
// Pure and fail-closed: this is what `verifyPortalPublicationSnapshot` asks of
// every v3 row it reads back, so a rule added here decides whether an
// immutable snapshot stays servable forever. Keep the limits generous and the
// rules structural; wording and design quality are the publisher's concern
// (readiness blockers), not the reader's.

import { isGuestLocale, isSupportedGuestLanguagePack } from '#/shared/domain/guest-locale'
import {
  languagePackGenerationOf,
  type ImmersiveBrandProfile,
  type ImmersiveLink,
  type ImmersiveLocalizedContent,
  type ImmersivePortalPublicationConfiguration,
  type PortalGuestLocale,
  type PortalSnapshotText,
} from './portal-publication-snapshot'

export const IMMERSIVE_SNAPSHOT_LIMITS = Object.freeze({
  titleLength: 120,
  shortDescriptionLength: 500,
  heroAltLength: 300,
  linktreeTitleLength: 120,
  linkLabelLength: 120,
  linkLineLength: 300,
  displayNameLength: 120,
  wordmarkLength: 24,
  maxLinks: 50,
  maxMediaPixels: 16_384,
  idLength: 64,
})

const ICON_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u
const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/iu

const isBlank = (value: string): boolean => value.trim().length === 0

function isBoundedId(value: string): boolean {
  return value.length > 0 && value.length <= IMMERSIVE_SNAPSHOT_LIMITS.idLength
}

/** An IANA zone name the runtime's `Intl` knows, such as `Europe/Sofia`. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function sameMembers(
  keys: readonly string[],
  localeSet: readonly PortalGuestLocale[],
): boolean {
  return keys.length === localeSet.length && localeSet.every((l) => keys.includes(l))
}

/** One locale's wording of something, reduced to what the fallback rules compare. */
type Wording = Readonly<{ fallbackFrom: PortalGuestLocale | null; fingerprint: string }>

/**
 * A fallback is a copy: `fallbackFrom` names another locale of the same set
 * whose own text (never a fallback itself) says exactly the same thing, and
 * the primary locale is always written, never copied. That keeps the tag
 * honest, because the page sets `lang` from it.
 */
function fallbacksHold(
  localeSet: readonly PortalGuestLocale[],
  primary: PortalGuestLocale,
  wordingOf: (locale: PortalGuestLocale) => Wording | undefined,
): boolean {
  if (wordingOf(primary)?.fallbackFrom !== null) return false
  return localeSet.every((locale) => {
    const own = wordingOf(locale)
    if (!own) return false
    if (own.fallbackFrom === null) return true
    const source = wordingOf(own.fallbackFrom)
    return (
      own.fallbackFrom !== locale &&
      localeSet.includes(own.fallbackFrom) &&
      source !== undefined &&
      source.fallbackFrom === null &&
      source.fingerprint === own.fingerprint
    )
  })
}

function hasValidLocaleSet(configuration: ImmersivePortalPublicationConfiguration) {
  const { localeSet, guestLocale } = configuration
  return (
    localeSet.length >= 1 &&
    new Set(localeSet).size === localeSet.length &&
    localeSet.every(isGuestLocale) &&
    localeSet[0] === guestLocale
  )
}

/** Every locale of the set carries a generation 2 pack of its own language, and only those. */
function hasGenerationTwoPacks(configuration: ImmersivePortalPublicationConfiguration) {
  const generation = languagePackGenerationOf(configuration.schemaVersion)
  const { localeSet, languagePackVersions } = configuration
  return (
    sameMembers(Object.keys(languagePackVersions), localeSet) &&
    localeSet.every((locale) =>
      isSupportedGuestLanguagePack(locale, languagePackVersions[locale], generation),
    ) &&
    configuration.languagePackVersion === languagePackVersions[configuration.guestLocale]
  )
}

function isBoundedText(text: PortalSnapshotText, maxLength: number): boolean {
  return text.value.length <= maxLength
}

function isCompleteLocaleContent(
  content: ImmersiveLocalizedContent,
  needsLinktreeTitle: boolean,
): boolean {
  const limits = IMMERSIVE_SNAPSHOT_LIMITS
  return (
    !isBlank(content.title.value) &&
    isBoundedText(content.title, limits.titleLength) &&
    !isBlank(content.shortDescription.value) &&
    isBoundedText(content.shortDescription, limits.shortDescriptionLength) &&
    isBoundedText(content.heroAlt, limits.heroAltLength) &&
    isBoundedText(content.linktreeTitle, limits.linktreeTitleLength) &&
    (!needsLinktreeTitle || !isBlank(content.linktreeTitle.value))
  )
}

const TEXT_KEYS = ['title', 'shortDescription', 'heroAlt', 'linktreeTitle'] as const

function hasCompleteContent(configuration: ImmersivePortalPublicationConfiguration) {
  const { localeSet, guestLocale, localizedContent, linktree, links } = configuration
  if (!sameMembers(Object.keys(localizedContent), localeSet)) return false
  const needsLinktreeTitle = linktree.enabled && links.length > 0
  const complete = localeSet.every((locale) => {
    const content = localizedContent[locale]
    return content !== undefined && isCompleteLocaleContent(content, needsLinktreeTitle)
  })
  return (
    complete &&
    TEXT_KEYS.every((key) =>
      fallbacksHold(localeSet, guestLocale, (locale) => {
        const text = localizedContent[locale]?.[key]
        return text && { fallbackFrom: text.fallbackFrom, fingerprint: text.value }
      }),
    )
  )
}

function isCompleteLink(link: ImmersiveLink, localeSet: readonly PortalGuestLocale[]) {
  const limits = IMMERSIVE_SNAPSHOT_LIMITS
  return (
    isBoundedId(link.id) &&
    isHttpsUrl(link.url) &&
    (link.iconKey === null || ICON_KEY_PATTERN.test(link.iconKey)) &&
    (link.imageAssetId === null || isBoundedId(link.imageAssetId)) &&
    sameMembers(Object.keys(link.texts), localeSet) &&
    localeSet.every((locale) => {
      const text = link.texts[locale]
      return (
        text !== undefined &&
        !isBlank(text.label) &&
        text.label.length <= limits.linkLabelLength &&
        (text.line === null ||
          (!isBlank(text.line) && text.line.length <= limits.linkLineLength))
      )
    })
  )
}

function hasCompleteLinks(configuration: ImmersivePortalPublicationConfiguration) {
  const { links, localeSet, guestLocale } = configuration
  return (
    links.length <= IMMERSIVE_SNAPSHOT_LIMITS.maxLinks &&
    new Set(links.map((link) => link.id)).size === links.length &&
    links.every(
      (link) =>
        isCompleteLink(link, localeSet) &&
        fallbacksHold(localeSet, guestLocale, (locale) => {
          const text = link.texts[locale]
          return (
            text && {
              fallbackFrom: text.fallbackFrom,
              fingerprint: JSON.stringify([text.label, text.line]),
            }
          )
        }),
    )
  )
}

function isValidMedia(media: { width: number; height: number }): boolean {
  const max = IMMERSIVE_SNAPSHOT_LIMITS.maxMediaPixels
  return (
    Number.isInteger(media.width) &&
    Number.isInteger(media.height) &&
    media.width >= 1 &&
    media.height >= 1 &&
    media.width <= max &&
    media.height <= max
  )
}

const isUnitInterval = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1

function isCompleteBrand(brand: ImmersiveBrandProfile): boolean {
  const limits = IMMERSIVE_SNAPSHOT_LIMITS
  const { logo, hero } = brand
  return (
    !isBlank(brand.displayName) &&
    brand.displayName.length <= limits.displayNameLength &&
    (brand.wordmark === null ||
      (!isBlank(brand.wordmark) && brand.wordmark.length <= limits.wordmarkLength)) &&
    (logo === null || (isBoundedId(logo.assetId) && isValidMedia(logo))) &&
    (hero === null ||
      (isBoundedId(hero.assetId) &&
        isValidMedia(hero) &&
        isUnitInterval(hero.focalX) &&
        isUnitInterval(hero.focalY))) &&
    HEX_COLOUR_PATTERN.test(brand.accentColour) &&
    HEX_COLOUR_PATTERN.test(brand.fieldColour) &&
    Number.isSafeInteger(brand.lookVersion) &&
    brand.lookVersion >= 1
  )
}

/**
 * Whether a v3 configuration is complete: every locale of the set has its
 * language pack (generation 2 only) and all of its text, every link has text
 * for every locale, fallbacks are honest copies, and the look and time zone
 * are well formed.
 */
export function isCompleteImmersiveConfiguration(
  configuration: ImmersivePortalPublicationConfiguration,
): boolean {
  return (
    hasValidLocaleSet(configuration) &&
    hasGenerationTwoPacks(configuration) &&
    hasCompleteContent(configuration) &&
    hasCompleteLinks(configuration) &&
    isCompleteBrand(configuration.brandProfile) &&
    isValidTimeZone(configuration.timeZone)
  )
}
