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

export type GetInboxItemsInput = Readonly<{
  filters: InboxFilters
  cursor?: Cursor
  limit?: number
}>

export type GetInboxItemsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxItems =
  (deps: GetInboxItemsDeps) =>
  async (input: GetInboxItemsInput, ctx: AuthContext): Promise<PaginatedResult> => {
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
      return { items: [], nextCursor: null }
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
    }

    return deps.repo.findFilteredPaginated(
      mergedFilters,
      ctx.organizationId,
      input.cursor,
      input.limit,
    )
  }

export type GetInboxItems = ReturnType<typeof getInboxItems>
