// Inbox context — inbox repository port
// Per architecture: "Repository ports for all data access."

import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import type {
  ReviewAspect,
  ReviewAspectPolarity,
  ReviewAttention,
} from './ai-review-insights.port'

export type Cursor = Readonly<{
  sourceDate: Date
  id: InboxItemId
}>

export type InboxSort = 'newest' | 'oldest'

/**
 * Visibility for one Inbox source family after intersecting the Inbox
 * permission scope with the owning context's permission scope.
 * `propertyIds === undefined` means organization-wide; an empty scope is
 * omitted by the authorizer and therefore matches no rows.
 */
export type InboxSourceScope = Readonly<{
  sourceType: SourceType
  propertyIds?: ReadonlyArray<PropertyId>
}>

export type InboxFilters = Readonly<{
  propertyId?: PropertyId
  propertyIds?: ReadonlyArray<PropertyId>
  status?: InboxStatus | ReadonlyArray<InboxStatus>
  isEscalated?: boolean
  sourceType?: SourceType
  assignedTo?: UserId
  replyStage?: Readonly<{
    match: 'include' | 'exclude'
    reviewIds: ReadonlyArray<ReviewId>
  }>
  /** Authorization-owned source/property predicates; never client supplied. */
  sourceScopes?: ReadonlyArray<InboxSourceScope>
  platform?: string
  ratingMin?: number
  ratingMax?: number
  sourceDateFrom?: Date
  sourceDateTo?: Date
  attention?: ReadonlyArray<ReviewAttention>
  aspect?: ReadonlyArray<ReviewAspect>
  polarity?: ReadonlyArray<ReviewAspectPolarity>
  /** A Property issue of the v3 analysis, by id: with `polarity`, the same mention. */
  issueId?: string
  q?: string
  sort?: InboxSort
}>

export type PaginatedResult = Readonly<{
  items: ReadonlyArray<InboxItem>
  nextCursor: Cursor | null
  /** Total rows matching the filters, before cursor pagination. */
  totalCount: number
}>

/** Rows matching the filters at one property. Properties with none are absent. */
export type InboxPropertyCount = Readonly<{ propertyId: PropertyId; count: number }>

export type InboxRepository = Readonly<{
  findById(id: InboxItemId, orgId: OrganizationId): Promise<InboxItem | null>
  findByIds(
    ids: ReadonlyArray<InboxItemId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyArray<InboxItem>>
  /**
   * Raw source-anchor lookup for durable materialization and repair. Unlike
   * active serving reads, this deliberately remains able to find a projection
   * whose current Handling Cycle Head is absent.
   */
  findBySource(
    sourceType: SourceType,
    sourceId: string,
    orgId: OrganizationId,
  ): Promise<InboxItem | null>
  /**
   * Active Review Inbox Item ids at one Property, keyed by Review id. An
   * active read: a Review whose projection has no current Handling Cycle head
   * is absent, exactly as `findById` would not find its item.
   */
  findActiveReviewItemIds(
    orgId: OrganizationId,
    propertyId: PropertyId,
    reviewIds: ReadonlyArray<ReviewId>,
  ): Promise<ReadonlyMap<ReviewId, InboxItemId>>
  findFilteredPaginated(
    filters: InboxFilters,
    orgId: OrganizationId,
    cursor?: Cursor,
    limit?: number,
  ): Promise<PaginatedResult>
  /** Count rows using the exact same governed predicates as the list. */
  countFiltered(filters: InboxFilters, orgId: OrganizationId): Promise<number>
  /** `countFiltered`, grouped by property: its counts sum to `countFiltered`. */
  countFilteredByProperty(
    filters: InboxFilters,
    orgId: OrganizationId,
  ): Promise<ReadonlyArray<InboxPropertyCount>>
  /**
   * Stamp the first reply-submitted / reply-published milestones and NOTHING
   * else.
   *
   * `inbox_items.status` mirrors the Handling Cycle head. This seam cannot
   * express a status, so milestone writes cannot move workflow authority.
   */
  stampReplyMilestones(
    id: InboxItemId,
    orgId: OrganizationId,
    milestones: Readonly<{
      firstReplySubmittedAt?: Date
      firstReplyPublishedAt?: Date
    }>,
    now?: Date,
  ): Promise<InboxItem | null>
  countByStatus(
    orgId: OrganizationId,
    status: InboxStatus,
    propertyIds?: ReadonlyArray<PropertyId>,
    sourceScopes?: ReadonlyArray<InboxSourceScope>,
  ): Promise<number>
  /** Count items with an active escalation flag (isEscalated AND not yet resolved). */
  countEscalatedActive(
    orgId: OrganizationId,
    propertyIds?: ReadonlyArray<PropertyId>,
    sourceScopes?: ReadonlyArray<InboxSourceScope>,
  ): Promise<number>
  /** Count `open` items created after `since` (null since = all open). */
  countOpenSince(
    orgId: OrganizationId,
    since: Date | null,
    propertyIds?: ReadonlyArray<PropertyId>,
    sourceScopes?: ReadonlyArray<InboxSourceScope>,
  ): Promise<number>
  findDetailById(id: InboxItemId, orgId: OrganizationId): Promise<InboxItemDetail | null>
  /**
   * BQC-3.4: lightweight keyset scan of review-sourced items for projection
   * rebuild — no enrichment lookups, ordered by id, resuming AFTER `cursor`.
   */
  scanReviewItems(
    orgId: OrganizationId,
    opts: Readonly<{ propertyId?: PropertyId; cursor?: InboxItemId; limit: number }>,
  ): Promise<ReadonlyArray<InboxItem>>
}>
