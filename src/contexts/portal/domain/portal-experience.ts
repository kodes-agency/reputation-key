import {
  PORTAL_LANGUAGE_PACK_VERSIONS,
  type PortalGuestLocale,
  type PortalPublicationExperienceSource,
} from './portal-publication-snapshot'
import { portalError } from './errors'

export const ACTIVE_PORTAL_GUEST_LOCALES = ['en', 'bg'] as const

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
    localeSet.some(
      (locale) => !ACTIVE_PORTAL_GUEST_LOCALES.includes(locale as PortalGuestLocale),
    )
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
      experience.languagePackVersions[locale] !== PORTAL_LANGUAGE_PACK_VERSIONS[locale]
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

export function selectPortalGuestLocale(
  localeSet: readonly PortalGuestLocale[],
  primary: PortalGuestLocale,
  requested?: string | null,
  signedSession?: string | null,
  acceptLanguage?: string | null,
): PortalGuestLocale {
  const allowed = new Set(localeSet)
  const candidates = [
    requested,
    signedSession,
    ...(acceptLanguage ?? '')
      .split(',')
      .map((part) => part.split(';')[0]?.trim())
      .filter((part): part is string => Boolean(part)),
  ]
  for (const candidate of candidates) {
    const base = candidate?.toLowerCase().split('-')[0]
    if ((base === 'en' || base === 'bg') && allowed.has(base)) return base
  }
  return allowed.has(primary) ? primary : (localeSet[0] ?? 'en')
}
