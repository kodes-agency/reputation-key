// Portal context — Property Brand and localized-content row mappers
// Pure functions: the only place where these rows and their domain shapes meet.

import type {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { parseGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { BACKGROUND_MODES, type BackgroundMode } from '../../domain/property-look'
import type {
  PortalLocalizedOverride,
  PropertyPortalBrandContent,
  PropertyPortalBrandProfile,
} from '../../application/ports/portal-experience.repository'

/** A stored mode outside the closed set is a corrupt row, never a quiet 'auto'. */
function backgroundModeFromRow(value: string): BackgroundMode {
  const mode = BACKGROUND_MODES.find((candidate) => candidate === value)
  if (!mode) throw new Error(`Brand profile row has an unknown background mode: ${value}`)
  return mode
}

/** The stored default languages, each checked against the catalogue. */
function defaultLocalesFromRow(value: unknown): readonly GuestLocale[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Brand profile row has no default guest languages')
  }
  return value.map((entry) => localeFromRow(String(entry)))
}

export const profileFromRow = (
  row: typeof propertyPortalBrandProfiles.$inferSelect,
): PropertyPortalBrandProfile => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  displayName: row.displayName,
  logoUrl: row.logoUrl,
  defaultHeroImageUrl: row.defaultHeroImageUrl,
  logoAssetId: row.logoAssetId,
  heroAssetId: row.heroAssetId,
  heroFocalX: row.heroFocalX,
  heroFocalY: row.heroFocalY,
  primaryColor: row.primaryColor,
  backgroundColor: row.backgroundColor,
  textColor: row.textColor,
  wordmark: row.wordmark,
  backgroundMode: backgroundModeFromRow(row.backgroundMode),
  defaultGuestLocales: defaultLocalesFromRow(row.defaultGuestLocales),
  lookVersion: row.lookVersion,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/** A stored locale outside the catalogue is a corrupt row, never a quiet English. */
function localeFromRow(value: string): GuestLocale {
  const locale = parseGuestLocale(value)
  if (!locale)
    throw new Error(`Portal experience row has an unknown guest locale: ${value}`)
  return locale
}

export const contentFromRow = (
  row: typeof propertyPortalBrandContents.$inferSelect,
): PropertyPortalBrandContent => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  locale: localeFromRow(row.locale),
  title: row.title,
  shortDescription: row.shortDescription,
  heroAltText: row.heroAltText,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const overrideFromRow = (
  row: typeof portalLocalizedOverrides.$inferSelect,
): PortalLocalizedOverride => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  portalId: portalId(row.portalId),
  locale: localeFromRow(row.locale),
  title: row.title,
  shortDescription: row.shortDescription,
  heroImageUrl: row.heroImageUrl,
  linktreeTitle: row.linktreeTitle,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
