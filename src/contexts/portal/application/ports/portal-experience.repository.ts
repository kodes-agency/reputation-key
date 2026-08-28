import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type {
  PortalBrandProfileSnapshot,
  PortalGuestLocale,
  PortalLocalizedContentSnapshot,
} from '../../domain/portal-publication-snapshot'

export type PropertyPortalBrandProfile = PortalBrandProfileSnapshot &
  Readonly<{
    id: string
    organizationId: OrganizationId
    propertyId: PropertyId
    updatedBy: UserId
    createdAt: Date
    updatedAt: Date
  }>

export type PropertyPortalBrandContent = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  locale: PortalGuestLocale
  title: string
  shortDescription: string
  version: number
  updatedBy: UserId
  createdAt: Date
  updatedAt: Date
}>

export type PortalLocalizedOverride = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  locale: PortalGuestLocale
  title: string | null
  shortDescription: string | null
  heroImageUrl: string | null
  version: number
  updatedBy: UserId
  createdAt: Date
  updatedAt: Date
}>

export type PortalExperienceRepository = Readonly<{
  getPropertyExperience: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<
    Readonly<{
      profile: PropertyPortalBrandProfile | null
      content: readonly PropertyPortalBrandContent[]
    }>
  >
  listPortalOverrides: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<readonly PortalLocalizedOverride[]>
  savePropertyProfile: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      profile: Omit<PortalBrandProfileSnapshot, 'version'>
      updatedBy: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandProfile>
  savePropertyContent: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      locale: PortalGuestLocale
      content: Pick<PortalLocalizedContentSnapshot, 'title' | 'shortDescription'>
      updatedBy: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandContent>
  savePortalOverride: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      portalId: PortalId
      locale: PortalGuestLocale
      override: Readonly<{
        title: string | null
        shortDescription: string | null
        heroImageUrl: string | null
      }>
      updatedBy: UserId
      at: Date
    }>,
  ) => Promise<PortalLocalizedOverride | null>
}>
