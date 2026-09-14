// Inbox context — get inbox items use case
// Returns a filtered, paginated list of inbox items.
// Enforces role-scoped property access internally.

import type {
  InboxRepository,
  InboxSourceScope,
  Cursor,
  InboxFilters,
  PaginatedResult,
} from '../ports/inbox.repository'
import type { PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxError } from '../../domain/errors'
import { resolveVisiblePropertyIds } from '../visible-properties'
import { propertyIdsForInboxSource, resolveInboxSourceScopes } from '../inbox-access'
import { canForContext } from '#/shared/domain/permissions'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import {
  REPLY_STAGE_QUEUES,
  queueToFilters,
  type InboxQueue,
  type InboxReplyStages,
} from '../inbox-queues'

export type GetInboxItemsInput = Readonly<{
  filters: InboxFilters
  queue?: InboxQueue
  cursor?: Cursor
  limit?: number
}>

export type GetInboxItemsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  replyLookup: ReplyLookupPort
  viewRepo: InboxViewRepository
  clock: () => Date
}>

export type InboxPageResult = PaginatedResult &
  Readonly<{
    /** Server cutoff captured before access resolution and page loading. */
    responseCutoff: Date
    /** The caller's last successful Inbox visit, captured with this page. */
    viewedUpTo: Date | null
  }>

const emptyInboxPage = (
  responseCutoff: Date,
  viewedUpTo: Date | null,
): InboxPageResult => ({
  items: [],
  nextCursor: null,
  totalCount: 0,
  responseCutoff,
  viewedUpTo,
})

async function scopedPropertyIds(
  deps: GetInboxItemsDeps,
  input: GetInboxItemsInput,
  ctx: AuthContext,
): Promise<ReadonlyArray<PropertyId> | null | undefined> {
  const visible = await resolveVisiblePropertyIds(deps.staffPublicApi, ctx, 'inbox.read')
  if (visible === 'none') return null
  if (visible === 'all') return undefined
  if (
    input.filters.propertyId &&
    !visible.includes(input.filters.propertyId as PropertyId)
  ) {
    throw inboxError('forbidden', 'No access to this property', {
      propertyId: input.filters.propertyId,
    })
  }
  return visible
}

async function queueFiltersForRequest(
  deps: GetInboxItemsDeps,
  input: GetInboxItemsInput,
  ctx: AuthContext,
  sourceScopes: ReadonlyArray<InboxSourceScope>,
  readableSources: ReadonlyArray<InboxSourceScope['sourceType']>,
  propertyIds: ReadonlyArray<PropertyId> | undefined,
  canManageReplies: boolean,
): Promise<InboxFilters | null | undefined> {
  let replyStages: InboxReplyStages = { awaiting: [], waiting: [] }
  let queueFilters = input.queue
    ? queueToFilters(input.queue, {
        viewerId: ctx.userId,
        canManageReplies,
        replyStages,
      })
    : undefined
  const requestedSourceType = input.filters.sourceType
  const queueSourceType = queueFilters?.sourceType
  if (
    queueSourceType !== undefined &&
    requestedSourceType !== undefined &&
    queueSourceType !== requestedSourceType
  ) {
    return null
  }
  const initialSourceType = queueSourceType ?? requestedSourceType
  if (initialSourceType !== undefined && !readableSources.includes(initialSourceType)) {
    return null
  }
  if (input.queue && REPLY_STAGE_QUEUES.has(input.queue)) {
    const narrowed = input.filters.propertyId ? [input.filters.propertyId] : propertyIds
    replyStages = await deps.replyLookup.findReviewIdsByReplyStage(
      ctx.organizationId,
      propertyIdsForInboxSource(sourceScopes, 'review', narrowed),
    )
    queueFilters = queueToFilters(input.queue, {
      viewerId: ctx.userId,
      canManageReplies,
      replyStages,
    })
  }
  return queueFilters
}

async function pageWithReplyStates(
  deps: GetInboxItemsDeps,
  page: PaginatedResult,
  ctx: AuthContext,
  responseCutoff: Date,
  viewedUpTo: Date | null,
): Promise<InboxPageResult> {
  if (!canForContext(ctx, 'reply.manage')) {
    return { ...page, responseCutoff, viewedUpTo }
  }
  const reviewIds = page.items.flatMap((item) =>
    item.sourceType === 'review' ? [item.sourceId as ReviewId] : [],
  )
  if (reviewIds.length === 0) return { ...page, responseCutoff, viewedUpTo }
  const replyStates = await deps.replyLookup.getReplyStatesByReviewIds(
    reviewIds,
    ctx.organizationId,
  )
  const items = page.items.map((item) =>
    item.sourceType === 'review'
      ? { ...item, replyState: replyStates.get(item.sourceId) ?? null }
      : item,
  )
  return { ...page, items, responseCutoff, viewedUpTo }
}

export const getInboxItems =
  (deps: GetInboxItemsDeps) =>
  async (input: GetInboxItemsInput, ctx: AuthContext): Promise<InboxPageResult> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }
    const responseCutoff = deps.clock()
    const viewedUpTo = input.cursor
      ? null
      : await deps.viewRepo.getLastInboxView(ctx.organizationId, ctx.userId)
    const sourceScopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    const readableSources = sourceScopes.map((scope) => scope.sourceType)
    if (readableSources.length === 0) return emptyInboxPage(responseCutoff, viewedUpTo)

    // Property scoping resolved per-permission: org-wide scope (AccountAdmin) →
    // 'all'; assigned scope (PropertyManager/Staff) → their staff_assignment
    // set; 'none' → fail-closed empty page (a scoped user with no assignments
    // must not see org-wide items).
    const propertyIds = await scopedPropertyIds(deps, input, ctx)
    if (propertyIds === null) return emptyInboxPage(responseCutoff, viewedUpTo)

    const canManageReplies = canForContext(ctx, 'reply.manage')
    const queueFilters = await queueFiltersForRequest(
      deps,
      input,
      ctx,
      sourceScopes,
      readableSources,
      propertyIds,
      canManageReplies,
    )
    if (queueFilters === null) return emptyInboxPage(responseCutoff, viewedUpTo)
    const sourceType = queueFilters?.sourceType ?? input.filters.sourceType

    const mergedFilters: InboxFilters = {
      ...input.filters,
      ...(queueFilters
        ? {
            status: queueFilters.status,
            isEscalated: queueFilters.isEscalated,
            assignedTo: queueFilters.assignedTo,
            replyStage: queueFilters.replyStage,
          }
        : {}),
      propertyIds: propertyIds ?? input.filters.propertyIds,
      sourceScopes,
      // There are exactly two source families. When only one is authorized,
      // forcing the existing singular filter keeps private feedback out of
      // both page rows and the authoritative filtered total.
      sourceType: readableSources.length === 1 ? readableSources[0] : sourceType,
    }

    const page = await deps.repo.findFilteredPaginated(
      mergedFilters,
      ctx.organizationId,
      input.cursor,
      input.limit,
    )
    return pageWithReplyStates(deps, page, ctx, responseCutoff, viewedUpTo)
  }

export type GetInboxItems = ReturnType<typeof getInboxItems>
