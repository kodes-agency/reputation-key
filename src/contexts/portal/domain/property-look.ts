// Portal context — the Property look: the facts of a Property's Brand Profile
// that decide how its guest pages look (as opposed to the public display name,
// which AI reply drafts also read). Pure rules; persistence lives in the
// experience repository.

import {
  GUEST_LOCALES,
  isGuestLocale,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import { portalError } from './errors'

export const BACKGROUND_MODES = Object.freeze(['auto', 'manual'] as const)
/** 'auto': the dark field follows the accent colour; 'manual': the background colour is the field. */
export type BackgroundMode = (typeof BACKGROUND_MODES)[number]

export const WORDMARK_MAX_LENGTH = 24
export const HERO_ALT_TEXT_MAX_LENGTH = 160

/** The look-bearing fields of a Brand Profile. */
export type PropertyLook = Readonly<{
  primaryColor: string
  backgroundColor: string
  textColor: string
  backgroundMode: BackgroundMode
  wordmark: string | null
  logoUrl: string | null
  defaultHeroImageUrl: string | null
}>

/** The parts of the look a pending change can name, in the order they are listed. */
export type LookFacet = 'accent' | 'field' | 'text' | 'wordmark' | 'images'

function boundedOrNull(value: string | null, field: string, max: number): string | null {
  if (value === null) return null
  const text = value.trim()
  if (text.length === 0) return null
  if (text.length > max) {
    throw portalError('invalid_description', `${field} must be at most ${max} characters`)
  }
  return text
}

/** The wordmark as stored: trimmed, at most 24 characters, empty meaning none. */
export function normaliseWordmark(value: string | null): string | null {
  return boundedOrNull(value, 'Wordmark', WORDMARK_MAX_LENGTH)
}

/** The hero photo's alt text as stored: trimmed, at most 160 characters, empty meaning none. */
export function normaliseHeroAltText(value: string | null): string | null {
  return boundedOrNull(value, 'Hero alt text', HERO_ALT_TEXT_MAX_LENGTH)
}

/**
 * The languages a new Portal starts with: one to six distinct catalogue
 * languages, the first being its primary.
 */
export function normaliseDefaultGuestLocales(
  locales: readonly GuestLocale[],
): readonly GuestLocale[] {
  if (locales.length === 0 || locales.length > GUEST_LOCALES.length) {
    throw portalError('locale_not_offered', 'Choose between one and six languages')
  }
  if (new Set(locales).size !== locales.length) {
    throw portalError('locale_not_offered', 'A language was given more than once')
  }
  if (!locales.every((locale) => isGuestLocale(locale))) {
    throw portalError('locale_not_offered', 'That language is not offered')
  }
  return [...locales]
}

/** The pending-change key of one facet of the look. */
export function lookPendingKey(facet: LookFacet): string {
  return `look:${facet}`
}

/** Which facets of the look differ between two profiles, in a fixed order. */
export function changedLookFacets(
  before: PropertyLook,
  after: PropertyLook,
): readonly LookFacet[] {
  const moved: readonly [LookFacet, boolean][] = [
    ['accent', before.primaryColor !== after.primaryColor],
    [
      'field',
      before.backgroundMode !== after.backgroundMode ||
        before.backgroundColor !== after.backgroundColor,
    ],
    ['text', before.textColor !== after.textColor],
    ['wordmark', before.wordmark !== after.wordmark],
    [
      'images',
      before.logoUrl !== after.logoUrl ||
        before.defaultHeroImageUrl !== after.defaultHeroImageUrl,
    ],
  ]
  return moved.flatMap(([facet, changed]) => (changed ? [facet] : []))
}
