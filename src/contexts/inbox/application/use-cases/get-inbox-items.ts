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
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../../domain/errors'

export type GetInboxItemsInput = Readonly<{
  filters: InboxFilters
  cursor?: Cursor
  limit?: number
}>

// fallow-ignore-next-line unused-type
export type GetInboxItemsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxItems =
  (deps: GetInboxItemsDeps) =>
  async (input: GetInboxItemsInput, ctx: AuthContext): Promise<PaginatedResult> => {
    // 0. Auth gate
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Property scoping resolved per-permission: org-wide scope (AccountAdmin) →
    // null (all properties); assigned scope (PropertyManager/Staff) → their
    // staff_assignment set. PM holds inbox.manage but inbox.read scope is
    // assigned — so PM is scoped (CONTEXT.md L72).
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'inbox.read',
    )

    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (accessible !== null) {
      if (accessible.length === 0) {
        return { items: [], nextCursor: null }
      }
      if (
        input.filters.propertyId &&
        !accessible.includes(input.filters.propertyId as PropertyId)
      ) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: input.filters.propertyId,
        })
      }
      propertyIds = accessible
    }

    const mergedFilters: InboxFilters = {
      ...input.filters,
      propertyIds: propertyIds ?? input.filters.propertyIds,
    }

    return deps.repo.findFilteredPaginated(
      mergedFilters,
      ctx.organizationId,
      input.cursor,
      input.limit,
    )
  }

// fallow-ignore-next-line unused-type
export type GetInboxItems = ReturnType<typeof getInboxItems>
