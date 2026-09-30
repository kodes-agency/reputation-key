/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort } from './ports/storage.port'
import type { GuestLanguagePackVersion, GuestLocale } from '#/shared/domain/guest-locale'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events.
export type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
  PortalDeleted,
  PortalArchived,
  PortalRestored,
  PortalPublicationPublished,
  PortalPublicationRolledBack,
  PortalResponsibilityNeeded,
  PortalEvent,
  PortalAccessArtifactPublished,
  PortalGroupDeleted,
} from '../domain/events'

export { isValidExternalUrl } from '../domain/rules'
export type { Portal } from '../domain/types'
/** C2: portal token existence/metadata for management surfaces — never token material. */
export type { PortalTokenStatus } from './portal-token-status'
export type {
  ListPortalOverviewInput,
  PortalOverviewRow,
} from './use-cases/list-portal-overview'
export type {
  PortalPublicationHistory,
  PortalPublicationHistoryItem,
} from './use-cases/get-portal-publication-history'
export type {
  PortalLinktreeDestination,
  PortalLinktreeDestinationState,
  PortalLinktreeLink,
  PortalLinktreeText,
  PortalLinktreeView,
} from '../domain/portal-linktree-view'
export type {
  PortalHistory,
  PortalHistoryEntry,
  GetPortalHistoryInput,
} from './use-cases/get-portal-history'
export type {
  MissingPortalText,
  PortalLanguageCoverage,
  PortalLanguageCoverageRow,
} from '../domain/portal-language-coverage'
export type {
  PortalHistoryCategory,
  PortalHistoryDetail,
  PortalHistoryFilter,
} from '../domain/portal-history'

import type {
  OrganizationId,
  PortalAccessArtifactId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import type { GuestSurface } from '../domain/portal-publication-snapshot'
import type { PortalAccessArtifactChannel } from '../domain/portal-access-artifact'
import type { PortalHealthReason, PortalHealthStatus } from '../domain/portal-health'
import type { PortalContactRequestManagerAuthorityFacts } from './use-cases/portal-contact-request-authority'
import type { AiReplyBrandProfile } from '#/shared/ai-reply-brand-profile'
import type { Tx } from '#/shared/outbox/commit'

/** Result of resolving a portal's context (org + property) by portal ID. */
type PortalContextResult = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** Full public portal data returned for guest-facing token lookups. */
export type PublicGoogleReviewDestination =
  Readonly<{ status: 'available'; uri: string }> | Readonly<{ status: 'unavailable' }>

/**
 * Internal submission evidence. Guest's browser projection deliberately omits
 * this object; the Guest context persists it with the private rating.
 */
type PublicPortalResponseConfiguration = Readonly<{
  publicationState: 'published'
  publicationSnapshotId: string
  publicationVersion: number
  publicationDigest: string
  /** SHA-256 of the exact resolved public configuration rendered by this load. */
  configurationDigest: string
  guestLocale: string
  languagePackVersion: string
  privateFeedbackThreshold: number
}>

/** A piece of guest-facing text, and the locale it was copied from when it is a fallback. */
export type PublicPortalText = Readonly<{
  value: string
  fallbackFrom: GuestLocale | null
}>

/** A Portal image turned into a servable URL at read time; absent when taken down. */
export type PublicPortalMedia = Readonly<{ url: string; width: number; height: number }>

export type PublicPortalHero = PublicPortalMedia &
  Readonly<{ focalX: number; focalY: number }>

/**
 * What the Immersive Hub renders beyond the legacy fields, present only for a
 * schema version 3 publication. Media appears as URLs, never as asset ids, and
 * history-only facts (provenance) never appear at all.
 */
export type PublicImmersiveExperience = Readonly<{
  /** An IANA zone name: deadlines on the page read in it. */
  timeZone: string
  brand: Readonly<{
    displayName: string
    wordmark: string | null
    logo: PublicPortalMedia | null
    hero: PublicPortalHero | null
    accentColour: string
    fieldColour: string
  }>
  /** The selected locale's wording. `shortDescription` is for `og:description` only. */
  content: Readonly<{
    title: PublicPortalText
    shortDescription: PublicPortalText
    heroAlt: PublicPortalText
    linktreeTitle: PublicPortalText
  }>
  linktree: Readonly<{ enabled: boolean }>
  /** Approved links only, in display order. The destination stays server-side. */
  links: ReadonlyArray<
    Readonly<{
      id: string
      iconKey: string | null
      imageUrl: string | null
      label: string
      line: string | null
      fallbackFrom: GuestLocale | null
    }>
  >
}>

export type PublicPortalResult = Readonly<{
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    logoUrl?: string | null

    organizationName: string
  }
  categories: ReadonlyArray<{ id: string; title: string; sortKey: string }>
  links: ReadonlyArray<{
    id: string
    label: string
    url: string
    categoryId: string | null
    sortKey: string
  }>
  reviewGateway: Readonly<{
    /** Ratings at or below this inclusive threshold may add private feedback. */
    privateFeedbackThreshold: number
    /** A stale/unavailable Property URI is never serialized to the guest. */
    googleReview: PublicGoogleReviewDestination
  }>
  localization: Readonly<{
    selectedLocale: GuestLocale
    primaryLocale: GuestLocale
    availableLocales: readonly GuestLocale[]
    /** Exact immutable UI copy pack pinned by the Publication Snapshot. */
    languagePackVersion: GuestLanguagePackVersion
  }>
  responseConfiguration: PublicPortalResponseConfiguration
  /**
   * Which guest page renders this publication, from its snapshot schema
   * version. The Guest projection derives the page's web fonts from it.
   */
  guestSurface: GuestSurface
  /** The Immersive Hub's content: present exactly when `guestSurface` is 'immersive'. */
  immersive: PublicImmersiveExperience | null
  organizationId: string
  propertyId: string
}>

type PublicPortalByTokenOutcome =
  | Readonly<{ status: 'found'; result: PublicPortalResult }>
  | Readonly<{ status: 'unavailable' }>

/**
 * Narrow owning-context facts used to recheck Contact Request reveal authority.
 * This carries identifiers only: no contact, feedback, permission, or session data.
 */
export type PortalContactRequestManagerAuthorityPublicApi = Readonly<{
  getContactRequestManagerAuthorityFacts: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalContactRequestManagerAuthorityFacts | null>
}>

/**
 * Portal-owned authority for the sole Property Brand field permitted in AI
 * Reply Drafting. The transaction-bound check lets Review adopt a browser-held
 * suggestion without querying Portal tables or leaving a profile-change race.
 */
export type PortalAiReplyBrandProfilePublicApi = Readonly<{
  readCurrentAiReplyBrandProfile: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<AiReplyBrandProfile | null>
  isCurrentAiReplyBrandProfile: (
    tx: Tx,
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      version: number
      displayNameDigest: string
    }>,
  ) => Promise<boolean>
}>

/**
 * Gives a Property its confirmed name as the public display name when it has
 * none, so AI reply drafting is not refused for a freshly imported Property.
 */
export type PortalPublicDisplayNameDefaultPublicApi = Readonly<{
  ensureDefaultPublicDisplayName: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      displayName: string
    }>,
  ) => Promise<boolean>
}>

/** Portal context public API — consumed by guest and other contexts. */
export type PortalPublicApi = Readonly<{
  /**
   * Resolve the org + property a portal belongs to, by portal ID.
   * No organizationId scoping — the portal ID acts as a capability token
   * for unauthenticated guest requests.
   */
  resolvePortalContext: (portalId: PortalId) => Promise<PortalContextResult | null>

  /**
   * Get minimal portal info (id, name, isActive) by org + portal ID.
   * Used by staff context to resolve assigned portal details.
   */
  getPortalInfo: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{
    id: PortalId
    name: string
    publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  }> | null>

  /**
   * ARC-03-T9: every Portal belonging to a Property, by id.
   *
   * Published so consumers resolve Portals through this public API instead of
   * reaching into the Portal repository.
   */
  listPortalIdsByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalId>>

  /** Bounded, deterministic request-time snapshot for explicit Goal assignment. */
  listCurrentPortalIds: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    limit: number,
  ) => Promise<ReadonlyArray<PortalId>>

  /**
   * Resolve a full public portal through a revocable opaque capability token.
   * Every unavailable posture deliberately collapses to one outcome.
   */
  findPublicPortalByToken: (
    rawToken: string,
    preference?: Readonly<{
      requestedLocale?: string | null
      sessionLocale?: string | null
      acceptLanguage?: string | null
    }>,
  ) => Promise<PublicPortalByTokenOutcome>
  /** Verifies a channel marker against its address and exact live publication. */
  resolvePublishedAccessArtifact: (
    input: Readonly<{
      accessArtifactId: PortalAccessArtifactId
      organizationId: OrganizationId
      propertyId: PropertyId
      portalId: PortalId
      publicationSnapshotId: string
      /** Ephemeral presented address capability; never persisted or emitted. */
      rawToken: string
      asOf: Date
    }>,
  ) => Promise<Readonly<{
    accessArtifactId: PortalAccessArtifactId
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    portalGroupId: PortalGroupId | null
    channel: PortalAccessArtifactChannel
  }> | null>
  /**
   * The versions that went live in `[startAt, endAt)`, oldest first: a
   * publication or a rollback, by version number. For markers on the Results
   * chart; identifiers and instants only, no content.
   */
  listPublicationActivationsBetween: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    window: Readonly<{ startAt: Date; endAt: Date }>,
  ) => Promise<
    ReadonlyArray<
      Readonly<{ version: number; kind: 'publish' | 'rollback'; activatedAt: Date }>
    >
  >
  /** Current assigned managers, revalidated against role and current Property access. */
  getResponsibleManagerUserIds: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<import('#/shared/domain/ids').UserId>>
  /**
   * The current Health interval for delayed health-notification admission:
   * its status and reason, and the instant it opened, which identifies it.
   */
  findPortalHealthNotificationFacts: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{
    propertyId: PropertyId
    status: PortalHealthStatus
    reason: PortalHealthReason
    effectiveFrom: Date
  }> | null>
}>

/** Minimal portal group info for cross-context consumers. */
type PortalGroupSummary = Readonly<{
  id: PortalGroupId
  propertyId: PropertyId
  name: string
}>

/** Portal group public API — consumed by other contexts for cross-context queries. */
export type PortalGroupPublicApi = Readonly<{
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
    asOf?: Date,
  ) => Promise<PortalGroupSummary | null>
  getGroupPortalIds: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
  ) => Promise<ReadonlyArray<PortalId>>
  /** Given portal IDs, return the distinct group IDs those portals belong to. */
  findGroupIdsByPortalIds: (
    orgId: OrganizationId,
    portalIds: ReadonlyArray<PortalId>,
  ) => Promise<ReadonlyArray<PortalGroupId>>
  portalGroupBelongsToProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    groupId: PortalGroupId,
  ) => Promise<boolean>
}>
