import type { GuestResponse } from '../domain/guest-response'
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

export type GuestResponsePeriodScope = GuestResponseScope &
  Readonly<{
    startAt: Date
    endAt: Date
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
   * Org-scoped snippet read for cross-context lookups (inbox enrichment).
   *
   * Deliberately NOT scoped to a property or portal, unlike every other read
   * here: an inbox item carries only its organization and the response id, and
   * the organization is the tenant boundary that matters for it. Returns the
   * shared fields only — never a session id, IP hash, or media reference.
   *
   * A withdrawn or deleted response is absent from the result: its content is
   * gone, so the inbox item must render as unavailable rather than as an empty
   * comment.
   */
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
  /**
   * Current integrity outcomes for rating responses in a half-open business
   * period. Refuses a period that is not a valid, non-empty range.
   */
  getPortalResponseIntegritySummary(
    input: GuestResponsePeriodScope,
  ): Promise<PortalResponseIntegritySummary>
  /** Private ratings of one Portal over a half-open period, by page language. */
  getPortalRatingLanguages(
    input: GuestResponsePeriodScope,
  ): Promise<PortalRatingLanguageBreakdown>
}>
