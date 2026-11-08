import type { createPortalRatingFacts } from './portal-rating-facts'
export type { PortalRatingFact } from './portal-rating-facts'
/** Named server capabilities and facts consumed by other contexts. */
export type { StoragePort } from './ports/storage.port'
export { StoredObjectTooLargeError } from './ports/storage.port'
import type { GuestLanguagePackVersion, GuestLocale } from '#/shared/domain/guest-locale'
// Event re-exports — cross-context consumers must import events from public-api, not domain/events.
export type { PortalResponsibilityNeeded } from '../domain/events'
export type { PortalOverviewRow } from './use-cases/list-portal-overview'
export type { PortalDestinationApprovalFacts } from './portal-destination-approval-facts'

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
import type { GoalReadinessFacts } from './goal-readiness-facts'
import type { AiReplyBrandProfile } from '#/shared/ai-reply-brand-profile'
import type { Tx } from '#/shared/outbox/commit'
import type { FindDestinationApprovalFacts } from './portal-destination-approval-facts'

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

type PublicPortalHero = PublicPortalMedia & Readonly<{ focalX: number; focalY: number }>

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
    skipPrivateRating: boolean
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
  /**
   * Which shape of address opened the page: the long website address or a print
   * code (ADR 0069). Content-free, for the page-read log; never the address itself.
   */
  addressShape: 'long' | 'short'
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
   * Get minimal Portal identity, rating setting and publication state by org + id.
   * Used by staff context to resolve assigned portal details.
   */
  getPortalInfo: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{
    id: PortalId
    kind?: 'place' | 'personal'
    skipPrivateRating?: boolean
    name: string
    publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  }> | null>

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
  /**
   * Whether a presented address is a print code (ADR 0069): shape only, no key and
   * no lookup. A print code carries its own marker, so the guest scan classifier
   * takes it as one.
   */
  isPrintCode: (rawToken: string) => boolean
  /**
   * Verifies a channel marker against its address and exact live publication. A
   * print code needs no marker, since its channel is the hash column that matched;
   * a marker it does claim must be that artifact's. A long address with no marker
   * resolves to null, without a query.
   */
  resolvePublishedAccessArtifact: (
    input: Readonly<{
      accessArtifactId: PortalAccessArtifactId | null
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
  /** Current Linktree labels and order; caller has already authorised the Property. */
  listResultsLinks: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<
    Readonly<{
      enabled: boolean
      rows: ReadonlyArray<
        Readonly<{ linkId: string; label: string; iconKey: string | null }>
      >
    }>
  >
  /** Published and rolled-back versions in `[startAt, endAt)`, oldest first. */
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
  /** Current working-copy rating eligibility for only the subject's Portals, without a cap. */
  listPortalRatingFacts: ReturnType<
    typeof createPortalRatingFacts
  >['listPortalRatingFacts']
  /**
   * What the Monthly portal goal needs about a Property's Portals: live since
   * and live intervals, code, marker and group, for every non-archived Portal in
   * name order, including the complete roster. No content; the caller has already authorized.
   */
  listGoalReadinessFacts: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    asOf: Date,
  ) => Promise<GoalReadinessFacts>
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
  /**
   * A site waiting for an account admin's approval, as its notice needs it:
   * whether it still waits, its host, and the Portal to decide it on.
   */
  findDestinationApprovalNotificationFacts: FindDestinationApprovalFacts
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
  /**
   * A group's minimal facts by id; null when the organization has no such
   * group or it is archived. The caller compares the Property.
   */
  getGroupInfo: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
  ) => Promise<PortalGroupSummary | null>
}>
