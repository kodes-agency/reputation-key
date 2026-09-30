import {
  isGuestLocale,
  isSupportedGuestLanguagePack,
  matchGuestLocale,
} from '#/shared/domain/guest-locale'
import {
  languagePackGenerationOf,
  PORTAL_PUBLICATION_SCHEMA_VERSION,
  PRIMARY_GUEST_LOCALE,
  type PortalGuestLocale,
  type PortalPublicationExperienceSource,
} from './portal-publication-snapshot'
import { portalError } from './errors'

/**
 * Recorded as `updatedBy` on a public display name RepKey filled in itself:
 * the Property's confirmed name, set when it was imported or backfilled. AI
 * reply drafts use it as-is; the setup wizard asks about it until someone
 * saves a name.
 */
export const AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR = 'system:public-display-name-default'

/** The colours a Property Brand Profile starts with before anyone picks them. */
export const DEFAULT_PROPERTY_BRAND_PALETTE = Object.freeze({
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
})

/** A person saved the public display name; an automatic one is not confirmed. */
export function isPublicDisplayNameConfirmed(
  profile: Readonly<{ updatedBy: string }> | null,
): boolean {
  return profile !== null && profile.updatedBy !== AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR
}

function channel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(color: string): number | null {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) return null
  return (
    0.2126 * channel(color.slice(1, 3)) +
    0.7152 * channel(color.slice(3, 5)) +
    0.0722 * channel(color.slice(5, 7))
  )
}

export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  if (foregroundLuminance === null || backgroundLuminance === null) return null
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function assertCompletePortalPublicationExperience(
  experience: PortalPublicationExperienceSource,
): void {
  const localeSet = [...new Set(experience.localeSet)]
  if (
    localeSet.length === 0 ||
    localeSet.length !== experience.localeSet.length ||
    !localeSet.includes(experience.primaryGuestLocale) ||
    localeSet.some((locale) => !isGuestLocale(locale))
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication locales are incomplete or unsupported',
    )
  }
  for (const locale of localeSet) {
    const content = experience.localizedContent[locale]
    if (
      !content ||
      content.title.trim().length === 0 ||
      content.title.length > 120 ||
      content.shortDescription.trim().length === 0 ||
      content.shortDescription.length > 500 ||
      !isSupportedGuestLanguagePack(
        locale,
        experience.languagePackVersions[locale],
        languagePackGenerationOf(PORTAL_PUBLICATION_SCHEMA_VERSION),
      )
    ) {
      throw portalError(
        'publication_snapshot_unavailable',
        `Portal publication content is incomplete for locale ${locale}`,
      )
    }
  }
  const brand = experience.brandProfile
  const textContrast = contrastRatio(brand.textColor, brand.backgroundColor)
  if (
    brand.displayName.trim().length === 0 ||
    brand.displayName.length > 120 ||
    !Number.isSafeInteger(brand.version) ||
    brand.version < 1 ||
    contrastRatio(brand.primaryColor, brand.backgroundColor) === null ||
    textContrast === null ||
    textContrast < 4.5
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Property Brand Profile is incomplete or does not meet accessible contrast',
    )
  }
}

/** The locales an Accept-Language header names, best first; `q=0` entries are dropped. */
function acceptedLocales(header: string | null | undefined): PortalGuestLocale[] {
  const ranked = (header ?? '').split(',').flatMap((part, position) => {
    const [tag = '', ...parameters] = part.split(';').map((piece) => piece.trim())
    const locale = matchGuestLocale(tag)
    if (!locale) return []
    const weight = parameters.find((piece) => /^q=/iu.test(piece))
    const quality = weight === undefined ? 1 : Number(weight.slice(2))
    return Number.isFinite(quality) && quality > 0 ? [{ locale, quality, position }] : []
  })
  // Stable: equal weights keep the header's own order.
  ranked.sort((a, b) => b.quality - a.quality || a.position - b.position)
  return ranked.map((entry) => entry.locale)
}

export function selectPortalGuestLocale(
  localeSet: readonly PortalGuestLocale[],
  primary: PortalGuestLocale,
  requested?: string | null,
  signedSession?: string | null,
  acceptLanguage?: string | null,
): PortalGuestLocale {
  const allowed = new Set(localeSet)
  const candidates = [
    ...[requested, signedSession].flatMap((tag) => {
      const locale = tag ? matchGuestLocale(tag) : null
      return locale ? [locale] : []
    }),
    ...acceptedLocales(acceptLanguage),
  ]
  const match = candidates.find((locale) => allowed.has(locale))
  if (match) return match
  return allowed.has(primary) ? primary : (localeSet[0] ?? PRIMARY_GUEST_LOCALE)
}
