// Portal context — Property Brand and localized-content row mappers
// Pure functions: the only place where these rows and their domain shapes meet.

import type {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { parseGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type {
  PortalLocalizedOverride,
  PropertyPortalBrandContent,
  PropertyPortalBrandProfile,
} from '../../application/ports/portal-experience.repository'

export const profileFromRow = (
  row: typeof propertyPortalBrandProfiles.$inferSelect,
): PropertyPortalBrandProfile => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  displayName: row.displayName,
  logoUrl: row.logoUrl,
  defaultHeroImageUrl: row.defaultHeroImageUrl,
  primaryColor: row.primaryColor,
  backgroundColor: row.backgroundColor,
  textColor: row.textColor,
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
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
