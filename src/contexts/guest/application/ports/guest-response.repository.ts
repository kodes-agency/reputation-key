import type { GuestMedia } from '../../domain/guest-media'
import type { GuestResponse } from '../../domain/guest-response'

export type GuestResponseScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

export type GuestResponseSnippet = Readonly<{
  id: string
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

export type GuestResponseRepository = Readonly<{
  findForSession(
    scope: GuestResponseScope,
    sessionId: string,
    asOf: Date,
  ): Promise<GuestResponse | null>
  findById(scope: GuestResponseScope, responseId: string): Promise<GuestResponse | null>
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
    organizationId: string,
    responseId: string,
  ): Promise<Readonly<{
    comment: string | null
    ratingValue: number | null
    feedbackSubmissionRevision?: number | null
  }> | null>
  /** Batched equivalent used by inbox list enrichment. */
  findSnippetsForOrg(
    organizationId: string,
    responseIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<GuestResponseSnippet>>
  /**
   * Tenant- and consent-scoped ids matching inbox content filters. Text and
   * rating predicates may only inspect fields the guest consented to share.
   */
  findEligibleSnippetIdsForOrg(
    organizationId: string,
    filter: GuestResponseContentFilter,
  ): Promise<ReadonlyArray<string>>
  /** Current integrity outcomes for rating responses in a half-open business period. */
  summarizePortalIntegrity(
    scope: GuestResponseScope,
    startAt: Date,
    endAt: Date,
  ): Promise<PortalResponseIntegritySummary>
  saveModeration(response: GuestResponse): Promise<boolean>
  insertMedia(media: GuestMedia): Promise<boolean>
  findMediaForSession(
    scope: GuestResponseScope,
    sessionId: string,
    mediaId: string,
  ): Promise<GuestMedia | null>
  claimMedia(media: GuestMedia, lease: string, now: Date): Promise<boolean>
  completeMedia(
    media: GuestMedia,
    lease: string,
    publicUrl: string,
    now: Date,
  ): Promise<boolean>
  queueMediaPurge(media: GuestMedia, now: Date): Promise<void>
  markMediaDeleted(scope: GuestResponseScope, objectKey: string, now: Date): Promise<void>
}>
