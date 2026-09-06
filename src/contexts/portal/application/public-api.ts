/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort, PortalStoragePort } from './ports/storage.port'

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
export type { PortalTokenStatus } from './use-cases/get-portal'
export type {
  PortalPublicationHistory,
  PortalPublicationHistoryItem,
} from './use-cases/get-portal-publication-history'

import type {
  OrganizationId,
  PortalAccessArtifactId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
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
    selectedLocale: 'en' | 'bg'
    primaryLocale: 'en' | 'bg'
    availableLocales: readonly ('en' | 'bg')[]
    /** Exact immutable UI copy pack pinned by the Publication Snapshot. */
    languagePackVersion: 'guest-ui-en-v1' | 'guest-ui-bg-v1'
  }>
  responseConfiguration: PublicPortalResponseConfiguration
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
  /** Current assigned managers, revalidated against role/access/participation. */
  getResponsibleManagerUserIds: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<import('#/shared/domain/ids').UserId>>
  /** Exact current enum/fence state for delayed health-notification admission. */
  findPortalHealthNotificationFacts: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{
    propertyId: PropertyId
    status: PortalHealthStatus
    reason: PortalHealthReason
    sourceVersion: string
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
