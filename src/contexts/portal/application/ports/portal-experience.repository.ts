import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { BackgroundMode } from '../../domain/property-look'
import type {
  PortalBrandProfileSnapshot,
  PortalGuestLocale,
  PortalLocalizedContentSnapshot,
} from '../../domain/portal-publication-snapshot'

export type PropertyPortalBrandProfile = PortalBrandProfileSnapshot &
  Readonly<{
    /** Short name for the page header when there is no logo; null for none. */
    wordmark: string | null
    backgroundMode: BackgroundMode
    /** The languages a new Portal starts with, first = its primary. */
    defaultGuestLocales: readonly PortalGuestLocale[]
    /**
     * Moves with everything a guest sees of the look. `version` (the snapshot's
     * own field) moves only with the public display name.
     */
    lookVersion: number
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
  /** Alt text of the hero photo in this language; null until one is written. */
  heroAltText: string | null
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
  /** The manager's own title for the link section; null means the pack's default. */
  linktreeTitle: string | null
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
      profile: Omit<PortalBrandProfileSnapshot, 'version'> &
        Readonly<{
          /** Left as it is when omitted; null clears it. */
          wordmark?: string | null
          /** Left as it is when omitted. */
          backgroundMode?: BackgroundMode
        }>
      updatedBy: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandProfile>
  /**
   * Choose the languages a new Portal starts with. They only seed new Portals,
   * so this moves neither version, records no pending change, emits no fact
   * and does not touch who last saved the profile. Null when the Property has
   * no Brand Profile.
   */
  saveDefaultGuestLocales: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      locales: readonly PortalGuestLocale[]
    }>,
  ) => Promise<PropertyPortalBrandProfile | null>
  /**
   * Insert the automatic public display name when the Property has no Brand
   * Profile yet. An existing profile is never touched. True when inserted.
   */
  ensurePropertyDisplayName: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      displayName: string
      at: Date
    }>,
  ) => Promise<boolean>
  /**
   * Save only the public display name. Colours are kept, or start from the
   * default palette; the version moves only when the name changes.
   */
  savePropertyDisplayName: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      displayName: string
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
      content: Pick<PortalLocalizedContentSnapshot, 'title' | 'shortDescription'> &
        Readonly<{
          /** Left as it is when omitted; null clears it. */
          heroAltText?: string | null
        }>
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
