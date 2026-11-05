import type { FeedbackId, OrganizationId } from '#/shared/domain/ids'

export type LegacyFeedbackSnippet = Readonly<{
  id: FeedbackId
  comment: string
  ratingValue: number | null
}>

export type LegacyFeedbackContentFilter = Readonly<{
  ratingMin?: number
  ratingMax?: number
  textQuery?: string
}>

export type GuestInteractionRepository = Readonly<{
  /** Tenant-scoped batch read for legacy inbox rows. */
  findFeedbackSnippetsByIds(
    ids: ReadonlyArray<FeedbackId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyArray<LegacyFeedbackSnippet>>
  /** Tenant-scoped content-filter match for legacy inbox rows. */
  findEligibleFeedbackIds(
    orgId: OrganizationId,
    filter: LegacyFeedbackContentFilter,
  ): Promise<ReadonlyArray<FeedbackId>>
}>
