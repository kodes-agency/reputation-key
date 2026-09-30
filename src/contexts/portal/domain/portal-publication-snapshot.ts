import type { GuestLocale } from '#/shared/domain/guest-locale'

export const LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION = 1 as const
export const PORTAL_PUBLICATION_SCHEMA_VERSION = 2 as const
/** First snapshot schema rendered by the Immersive Hub guest page. */
export const IMMERSIVE_HUB_SCHEMA_VERSION = 3 as const
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

/** The review gateway and the Google destination binding every schema version carries. */
type PortalPublicationGatewayFacts = Readonly<{
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

type PortalPublicationConfigurationBase = PortalPublicationGatewayFacts &
  Readonly<{
    portal: PortalPublicationSource['portal']
    categories: PortalPublicationSource['categories']
    links: PortalPublicationSource['links']
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

// ── schema version 3: the Immersive Hub shape ────────────────────────────────
//
// The complete v3 JSON shape is fixed here, in the release that only reads it
// (ADR 0061). The digest is recomputed over the zod-parsed object on every
// read, so a field this shape does not name would be stripped, change the
// digest and turn the portal unavailable. Any later guest-visible field
// therefore needs a v4 with its own reader-first release.

/**
 * A piece of guest-facing text. `fallbackFrom` is null when the text was
 * written in its own locale, and names the locale it was copied from when the
 * publication filled a gap from the fallback language.
 */
export type PortalSnapshotText = Readonly<{
  value: string
  fallbackFrom: PortalGuestLocale | null
}>

export type ImmersiveLocalizedContent = Readonly<{
  title: PortalSnapshotText
  /** For `og:description` only; the Immersive Hub never renders it. */
  shortDescription: PortalSnapshotText
  /** Empty when the portal has no hero photo. */
  heroAlt: PortalSnapshotText
  linktreeTitle: PortalSnapshotText
}>

/** One locale's wording of a link, written or copied as a unit. */
export type ImmersiveLinkText = Readonly<{
  label: string
  line: string | null
  fallbackFrom: PortalGuestLocale | null
}>

/** A link tile, in display order: the array position is the order. */
export type ImmersiveLink = Readonly<{
  id: string
  url: string
  /** Names an icon in the guest page's icon map; null shows the default tile. */
  iconKey: string | null
  /** A Portal media asset, turned into a URL when the page is read. */
  imageAssetId: string | null
  texts: Readonly<Partial<Record<PortalGuestLocale, ImmersiveLinkText>>>
}>

export type ImmersiveMediaReference = Readonly<{
  assetId: string
  width: number
  height: number
}>

export type ImmersiveHeroReference = ImmersiveMediaReference &
  Readonly<{ focalX: number; focalY: number }>

export type ImmersiveBrandProfile = Readonly<{
  displayName: string
  wordmark: string | null
  logo: ImmersiveMediaReference | null
  hero: ImmersiveHeroReference | null
  accentColour: string
  fieldColour: string
  lookVersion: number
}>

export type ImmersivePortalPublicationConfiguration = PortalPublicationGatewayFacts &
  Readonly<{
    schemaVersion: typeof IMMERSIVE_HUB_SCHEMA_VERSION
    portal: Readonly<{ id: string; slug: string }>
    /** The primary locale; it is also `localeSet[0]`. */
    guestLocale: PortalGuestLocale
    /** The generation 2 pack of the primary locale. */
    languagePackVersion: string
    localeSet: readonly PortalGuestLocale[]
    languagePackVersions: Readonly<Partial<Record<PortalGuestLocale, string>>>
    localizedContent: Readonly<
      Partial<Record<PortalGuestLocale, ImmersiveLocalizedContent>>
    >
    linktree: Readonly<{ enabled: boolean }>
    links: readonly ImmersiveLink[]
    brandProfile: ImmersiveBrandProfile
    /** An IANA time zone: deadlines on the page read in it. */
    timeZone: string
    /** Which texts began as AI drafts, for history only. Never reaches a guest. */
    provenance?: Readonly<{ aiDraftTextKeys: readonly string[] }>
  }>

export type PortalPublicationConfiguration =
  | LegacyPortalPublicationConfiguration
  | LocalizedPortalPublicationConfiguration
  | ImmersivePortalPublicationConfiguration

/**
 * Whether a configuration carries a locale set and a language-pack map: schema
 * version 2 and every later version. The one place that answers the question,
 * so a new schema version changes a single line instead of eleven branches.
 * What else the configuration carries (the v2 brand profile and content, or
 * the v3 ones) still depends on the exact version.
 */
export function isLocalizedConfiguration<C extends { readonly schemaVersion: number }>(
  configuration: C,
): configuration is Extract<C, { readonly schemaVersion: 2 | 3 }> {
  return configuration.schemaVersion >= PORTAL_PUBLICATION_SCHEMA_VERSION
}

/** The language-pack generation a snapshot schema version may carry (ADR 0061). */
export function languagePackGenerationOf(schemaVersion: number): 1 | 2 {
  return schemaVersion >= IMMERSIVE_HUB_SCHEMA_VERSION ? 2 : 1
}

/** Which guest page renders a snapshot: the pre-round-4 one, or the Immersive Hub. */
export type GuestSurface = 'legacy' | 'immersive'

/**
 * The guest surface a configuration is rendered on: schema version 3 and later
 * are the Immersive Hub, versions 1 and 2 stay on the legacy page. Everything
 * that must agree with the renderer (the web fonts today) derives from this one
 * fact instead of guessing from another field.
 */
export function guestSurfaceOfConfiguration(
  configuration: Readonly<{ schemaVersion: number }>,
): GuestSurface {
  return configuration.schemaVersion >= IMMERSIVE_HUB_SCHEMA_VERSION
    ? 'immersive'
    : 'legacy'
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
