// Inbox context — get inbox items use case
// Returns a filtered, paginated list of inbox items.

import type { InboxRepository } from '../ports/inbox.repository'
import type { Cursor, InboxFilters, PaginatedResult } from '../ports/inbox.repository'
import type { OrganizationId } from '#/shared/domain/ids'

export type GetInboxItemsInput = Readonly<{
  organizationId: OrganizationId
  filters: InboxFilters
  cursor?: Cursor
  limit?: number
}>

// fallow-ignore-next-line unused-type
export type GetInboxItemsDeps = Readonly<{
  repo: InboxRepository
}>

export const getInboxItems =
  (deps: GetInboxItemsDeps) =>
  async (input: GetInboxItemsInput): Promise<PaginatedResult> => {
    return deps.repo.findFilteredPaginated(
      input.filters,
      input.organizationId,
      input.cursor,
      input.limit,
    )
  }

// fallow-ignore-next-line unused-type
export type GetInboxItems = ReturnType<typeof getInboxItems>
