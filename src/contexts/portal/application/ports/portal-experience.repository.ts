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
    /** Uploaded logo and photograph (portal_media_assets of this Property); null for none. */
    logoAssetId: string | null
    heroAssetId: string | null
    /** Where the photograph is anchored: 0 to 1 across and down; null exactly when there is no photograph. */
    heroFocalX: number | null
    heroFocalY: number | null
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
   * Save the look alone: the accent, the background and the wordmark. It reads
   * and writes the Brand Profile inside the Property's publication lock, so a
   * display-name or image write that lands beside it is never reverted, and it
   * leaves the public display name, the images, the text colour and who last
   * saved the profile (that decides whether the name counts as confirmed) as
   * they are. `actorUserId` is recorded in the page-edit ledger only. The
   * look version, the pending changes and the fact move as for any look edit.
   * A manual `backgroundColor` is kept when omitted; so is the wordmark. Null
   * when the Property has no Brand Profile.
   */
  savePropertyLook: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      look: Readonly<{
        primaryColor: string
        backgroundMode: BackgroundMode
        backgroundColor?: string
        /** Left as it is when omitted; null clears it. */
        wordmark?: string | null
      }>
      actorUserId: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandProfile | null>
  /**
   * Put the Property's photograph on its look, move where it is anchored, or
   * take it off (`hero: null`, which also clears the focal point). The asset's
   * purpose and state are the caller's to have checked. `altTexts` sets the
   * photograph's description per language (null clears one; a language left
   * out keeps its own). A description is kept in the language's wording row; a
   * language with none gets one holding the description alone, which is not
   * wording (its title and description read as unwritten). Like the other look
   * writers it works inside the Property's publication lock, moves the look
   * version, fences the live Portals and leaves the display name and who last
   * saved the profile alone. Null when the Property has no Brand Profile.
   */
  savePropertyHero: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      hero: Readonly<{ assetId: string; focalX: number; focalY: number }> | null
      altTexts?: ReadonlyArray<
        Readonly<{ locale: PortalGuestLocale; text: string | null }>
      >
      actorUserId: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandProfile | null>
  /** Put an uploaded logo on the look, or take it off (`null`). The asset is the caller's to have checked; otherwise as `savePropertyHero`. */
  savePropertyLogo: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      logoAssetId: string | null
      actorUserId: UserId
      at: Date
    }>,
  ) => Promise<PropertyPortalBrandProfile | null>
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
