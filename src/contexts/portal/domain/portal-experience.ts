import { contrastRatio, MIN_TEXT_CONTRAST } from '#/shared/domain/portal-field-colour'
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
  type LegacyPortalPublicationExperienceSource,
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

export function assertCompletePortalPublicationExperience(
  experience: LegacyPortalPublicationExperienceSource,
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
    textContrast < MIN_TEXT_CONTRAST
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
