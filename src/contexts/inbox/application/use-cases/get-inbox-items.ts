// Inbox context — get inbox items use case
// Returns a filtered, paginated list of inbox items.
// Enforces role-scoped property access internally.

import type { InboxRepository } from '../ports/inbox.repository'
import type { Cursor, InboxFilters, PaginatedResult } from '../ports/inbox.repository'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole, ADMIN_ROLE } from '#/shared/domain/roles'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { inboxError } from '../../domain/errors'

export type GetInboxItemsInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  role: Role
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
  async (input: GetInboxItemsInput): Promise<PaginatedResult> => {
    let propertyIds: ReadonlyArray<ReturnType<typeof toPropertyId>> | undefined

    if (!hasRole(input.role, ADMIN_ROLE)) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )

      if (accessible !== null) {
        if (accessible.length === 0) {
          return { items: [], nextCursor: null }
        }

        if (
          input.filters.propertyId &&
          !accessible.includes(
            input.filters.propertyId as ReturnType<typeof toPropertyId>,
          )
        ) {
          throw inboxError('forbidden', 'No access to this property', {
            propertyId: input.filters.propertyId,
          })
        }

        propertyIds = accessible
      }
    }

    const mergedFilters: InboxFilters = {
      ...input.filters,
      propertyIds: propertyIds ?? input.filters.propertyIds,
    }

    return deps.repo.findFilteredPaginated(
      mergedFilters,
      input.organizationId,
      input.cursor,
      input.limit,
    )
  }

// fallow-ignore-next-line unused-type
export type GetInboxItems = ReturnType<typeof getInboxItems>
