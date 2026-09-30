import type { GuestLocale } from '#/shared/domain/guest-locale'

export const LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION = 1 as const
export const PORTAL_PUBLICATION_SCHEMA_VERSION = 2 as const
export const PRIMARY_GUEST_LOCALE = 'en' as const

// Historical pins. Snapshots are immutable and must verify forever, so these
// stay literal: they are never derived from a "current" pack, and adding a
// pack elsewhere must not change what a v1 or v2 digest covers.
export const LEGACY_V1_GUEST_LOCALE = 'en' as const
export const LEGACY_V1_LANGUAGE_PACK = 'guest-ui-en-v1' as const
/** Old name of {@link LEGACY_V1_LANGUAGE_PACK}. */
export const PRIMARY_GUEST_LANGUAGE_PACK_VERSION = LEGACY_V1_LANGUAGE_PACK
export const V2_LANGUAGE_PACK_VERSIONS = {
  en: 'guest-ui-en-v1',
  bg: 'guest-ui-bg-v1',
} as const
/** Old name of {@link V2_LANGUAGE_PACK_VERSIONS}. */
export const PORTAL_LANGUAGE_PACK_VERSIONS = V2_LANGUAGE_PACK_VERSIONS

export type PortalGuestLocale = GuestLocale

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
  languagePackVersions: Readonly<Partial<Record<PortalGuestLocale, string>>>
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
    guestLocale: typeof LEGACY_V1_GUEST_LOCALE
    languagePackVersion: typeof LEGACY_V1_LANGUAGE_PACK
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

/**
 * Whether a configuration carries per-locale content, a language-pack map and a
 * brand profile: schema version 2 today, and every later version that keeps
 * that shape. The one place that answers the question, so a new schema version
 * changes a single line instead of eleven branches.
 */
export function isLocalizedConfiguration<C extends { readonly schemaVersion: number }>(
  configuration: C,
): configuration is Extract<C, { readonly schemaVersion: 2 }> {
  return configuration.schemaVersion === PORTAL_PUBLICATION_SCHEMA_VERSION
}

/**
 * The columns a snapshot row keeps as its own copy of the configuration's
 * locale and brand facts. The reader refuses a row that disagrees with its
 * configuration, so both are derived from the configuration here.
 */
export function snapshotMirrorColumns(configuration: PortalPublicationConfiguration) {
  if (!isLocalizedConfiguration(configuration)) {
    return {
      localeSet: [LEGACY_V1_GUEST_LOCALE],
      languagePackVersions: { [LEGACY_V1_GUEST_LOCALE]: LEGACY_V1_LANGUAGE_PACK },
      localizedContent: {},
      brandProfileVersion: null,
    }
  }
  return {
    localeSet: configuration.localeSet,
    languagePackVersions: configuration.languagePackVersions,
    localizedContent: configuration.localizedContent,
    brandProfileVersion: configuration.brandProfile.version,
  }
}

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
