export const LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION = 1 as const
export const PORTAL_PUBLICATION_SCHEMA_VERSION = 2 as const
export const PRIMARY_GUEST_LOCALE = 'en' as const
export const PRIMARY_GUEST_LANGUAGE_PACK_VERSION = 'guest-ui-en-v1' as const
export const PORTAL_LANGUAGE_PACK_VERSIONS = {
  en: 'guest-ui-en-v1',
  bg: 'guest-ui-bg-v1',
} as const

export type PortalGuestLocale = keyof typeof PORTAL_LANGUAGE_PACK_VERSIONS

export type PortalBrandProfileSnapshot = Readonly<{
  displayName: string
  logoUrl: string | null
  defaultHeroImageUrl: string | null
  primaryColor: string
  backgroundColor: string
  textColor: string
  version: number
}>

export type PortalLocalizedContentSnapshot = Readonly<{
  title: string
  shortDescription: string
  heroImageUrl: string | null
}>

export type PortalPublicationExperienceSource = Readonly<{
  primaryGuestLocale: PortalGuestLocale
  localeSet: readonly PortalGuestLocale[]
  languagePackVersions: Readonly<Record<PortalGuestLocale, string>>
  localizedContent: Readonly<
    Partial<Record<PortalGuestLocale, PortalLocalizedContentSnapshot>>
  >
  brandProfile: PortalBrandProfileSnapshot
}>

export type PortalPublicationSource = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Readonly<Record<string, string | number | boolean | null>> | null
    organizationName: string
  }>
  categories: ReadonlyArray<Readonly<{ id: string; title: string; sortKey: string }>>
  links: ReadonlyArray<
    Readonly<{
      id: string
      label: string
      url: string
      categoryId: string | null
      sortKey: string
    }>
  >
  privateFeedbackThreshold: number
  organizationId: string
  propertyId: string
  /** Missing only for immutable pre-localization snapshots and legacy classification. */
  experience?: PortalPublicationExperienceSource
}>

export type VerifiedPublicationDestination = Readonly<{
  state: 'verified'
  uri: string
  retrievedAt: Date
  sourceEpoch: number
  profileVersion: number
}>

type PortalPublicationConfigurationBase = Readonly<{
  portal: PortalPublicationSource['portal']
  categories: PortalPublicationSource['categories']
  links: PortalPublicationSource['links']
  reviewGateway: Readonly<{
    privateFeedbackThreshold: number
    googleReview: Readonly<{ status: 'available'; uri: string }>
  }>
  googleReviewBinding: Readonly<{
    retrievedAt: string
    sourceEpoch: number
    profileVersion: number
  }>
}>

export type LegacyPortalPublicationConfiguration = PortalPublicationConfigurationBase &
  Readonly<{
    schemaVersion: typeof LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION
    guestLocale: typeof PRIMARY_GUEST_LOCALE
    languagePackVersion: typeof PRIMARY_GUEST_LANGUAGE_PACK_VERSION
  }>

export type LocalizedPortalPublicationConfiguration = PortalPublicationConfigurationBase &
  Readonly<{
    schemaVersion: typeof PORTAL_PUBLICATION_SCHEMA_VERSION
    guestLocale: PortalGuestLocale
    languagePackVersion: string
    localeSet: readonly PortalGuestLocale[]
    languagePackVersions: Readonly<Partial<Record<PortalGuestLocale, string>>>
    localizedContent: Readonly<
      Partial<Record<PortalGuestLocale, PortalLocalizedContentSnapshot>>
    >
    brandProfile: PortalBrandProfileSnapshot
  }>

export type PortalPublicationConfiguration =
  LegacyPortalPublicationConfiguration | LocalizedPortalPublicationConfiguration

export type PortalPublicationSnapshot = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  version: number
  configurationDigest: string
  configuration: PortalPublicationConfiguration
  destinationUri: string
  destinationRetrievedAt: Date
  destinationSourceEpoch: number
  destinationProfileVersion: number
  createdBy: string
  createdAt: Date
}>

export type PortalPublicationActivation = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  snapshotId: string
  activationSequence: number
  kind: 'publish' | 'rollback'
  activatedBy: string
  activatedAt: Date
  deactivatedAt: Date | null
  deactivationReason: 'disabled' | 'archived' | 'replaced' | null
}>
