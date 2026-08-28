// Inbox context — get inbox items use case
// Returns a filtered, paginated list of inbox items.
// Enforces role-scoped property access internally.

import type {
  InboxRepository,
  Cursor,
  InboxFilters,
  PaginatedResult,
} from '../ports/inbox.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { inboxError } from '../../domain/errors'
import { resolveVisiblePropertyIds } from '../visible-properties'
import { resolveInboxSourceScopes } from '../inbox-access'
import { canForContext } from '#/shared/domain/permissions'

export type GetInboxItemsInput = Readonly<{
  filters: InboxFilters
  cursor?: Cursor
  limit?: number
}>

export type GetInboxItemsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export type InboxPageResult = PaginatedResult &
  Readonly<{
    /** Server cutoff captured before access resolution and page loading. */
    responseCutoff: Date
  }>

export const getInboxItems =
  (deps: GetInboxItemsDeps) =>
  async (input: GetInboxItemsInput, ctx: AuthContext): Promise<InboxPageResult> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }
    const responseCutoff = deps.clock()
    const emptyPage = (): InboxPageResult => ({
      items: [],
      nextCursor: null,
      totalCount: 0,
      responseCutoff,
    })
    const sourceScopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    const readableSources = sourceScopes.map((scope) => scope.sourceType)
    if (
      readableSources.length === 0 ||
      (input.filters.sourceType !== undefined &&
        !readableSources.includes(input.filters.sourceType))
    ) {
      return emptyPage()
    }

    // Property scoping resolved per-permission: org-wide scope (AccountAdmin) →
    // 'all'; assigned scope (PropertyManager/Staff) → their staff_assignment
    // set; 'none' → fail-closed empty page (a scoped user with no assignments
    // must not see org-wide items).
    const visible = await resolveVisiblePropertyIds(
      deps.staffPublicApi,
      ctx,
      'inbox.read',
    )
    if (visible === 'none') {
      return emptyPage()
    }

    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (visible !== 'all') {
      if (
        input.filters.propertyId &&
        !visible.includes(input.filters.propertyId as PropertyId)
      ) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: input.filters.propertyId,
        })
      }
      propertyIds = visible
    }

    const mergedFilters: InboxFilters = {
      ...input.filters,
      propertyIds: propertyIds ?? input.filters.propertyIds,
      sourceScopes,
      // There are exactly two source families. When only one is authorized,
      // forcing the existing singular filter keeps private feedback out of
      // both page rows and the authoritative filtered total.
      sourceType:
        readableSources.length === 1 ? readableSources[0] : input.filters.sourceType,
    }

    const page = await deps.repo.findFilteredPaginated(
      mergedFilters,
      ctx.organizationId,
      input.cursor,
      input.limit,
    )
    return { ...page, responseCutoff }
  }

export type GetInboxItems = ReturnType<typeof getInboxItems>
