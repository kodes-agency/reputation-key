import type { GuestResponse } from '../../domain/guest-response'
import type {
  GuestResponseId,
  GuestSessionId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'

export type GuestResponseScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
}>

export type GuestResponseSnippet = Readonly<{
  id: GuestResponseId
  comment: string | null
  ratingValue: number | null
  feedbackSubmissionRevision?: number | null
}>

export type GuestResponseContentFilter = Readonly<{
  ratingMin?: number
  ratingMax?: number
  textQuery?: string
}>

export type PortalResponseIntegritySummary = Readonly<{
  accepted: number
  filteredAutomatically: number
  underReview: number
  total: number
}>

/**
 * Eligible private ratings of one Portal, by the language of the page the guest
 * saw when they rated (pinned by the response's experience snapshot). A rating
 * older than the snapshots has no recorded language and is counted on its own
 * line, never guessed. `total` is every counted rating, `unrecorded` included.
 */
export type PortalRatingLanguageBreakdown = Readonly<{
  total: number
  /** Most ratings first; ties by locale, so the order is stable. */
  languages: ReadonlyArray<Readonly<{ locale: string; count: number }>>
  unrecorded: number
}>

export type GuestResponseRepository = Readonly<{
  findForSession(
    scope: GuestResponseScope,
    sessionId: GuestSessionId,
    asOf: Date,
  ): Promise<GuestResponse | null>
  findById(
    scope: GuestResponseScope,
    responseId: GuestResponseId,
  ): Promise<GuestResponse | null>
  /**
   * Org-scoped snippet read for cross-context lookups (inbox item rendering).
   *
   * Deliberately NOT scoped to a property or portal, unlike every other read
   * here: an inbox item carries only its organization and the response id, and
   * the organization is the tenant boundary that matters for it. Returns the
   * shared fields only — never a session id, IP hash, or media reference.
   *
   * A withdrawn or deleted response returns null: its content is gone, so the
   * inbox item must render as unavailable rather than as an empty comment.
   */
  findSnippetForOrg(
    organizationId: OrganizationId,
    responseId: GuestResponseId,
  ): Promise<Readonly<{
    comment: string | null
    ratingValue: number | null
    feedbackSubmissionRevision?: number | null
  }> | null>
  /** Batched equivalent used by inbox list enrichment. */
  findSnippetsForOrg(
    organizationId: OrganizationId,
    responseIds: ReadonlyArray<GuestResponseId>,
  ): Promise<ReadonlyArray<GuestResponseSnippet>>
  /**
   * Tenant- and consent-scoped ids matching inbox content filters. Text and
   * rating predicates may only inspect fields the guest consented to share.
   */
  findEligibleSnippetIdsForOrg(
    organizationId: OrganizationId,
    filter: GuestResponseContentFilter,
  ): Promise<ReadonlyArray<GuestResponseId>>
  /** Current integrity outcomes for rating responses in a half-open business period. */
  summarizePortalIntegrity(
    scope: GuestResponseScope,
    startAt: Date,
    endAt: Date,
  ): Promise<PortalResponseIntegritySummary>
  summarizePortalRatingLanguages(
    scope: GuestResponseScope,
    startAt: Date,
    endAt: Date,
  ): Promise<PortalRatingLanguageBreakdown>
  saveModeration(response: GuestResponse): Promise<boolean>
}>
