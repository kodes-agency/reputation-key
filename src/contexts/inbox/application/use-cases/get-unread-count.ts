// Inbox context — get unread count use case
// Returns the unread count for an org, with fallback to repo count.
//
// Design note: Unread is org-level (see UnreadCounterPort for rationale).
// userId is NOT part of the counter scope.

import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { InboxRepository } from '../ports/inbox.repository'
import type { OrganizationId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

export type GetUnreadCountInput = Readonly<{
  organizationId: OrganizationId
}>

// fallow-ignore-next-line unused-type
export type GetUnreadCountDeps = Readonly<{
  unreadCounter: UnreadCounterPort
  repo: InboxRepository
}>

export const getUnreadCount =
  (deps: GetUnreadCountDeps) =>
  async (input: GetUnreadCountInput): Promise<number> => {
    // 1. Try counter first
    try {
      const count = await deps.unreadCounter.getCount(input.organizationId)
      if (count > 0) return count
    } catch (e) {
      // Counter unavailable, fall through to repo
      getLogger().warn(
        { err: e },
        'Unread counter unavailable, falling back to repo count',
      )
    }

    // 2. Fallback: count from repo, warm the counter cache
    const dbCount = await deps.repo.countByStatus(input.organizationId, 'new')
    if (dbCount > 0) {
      try {
        await deps.unreadCounter.setCount(input.organizationId, dbCount)
      } catch {
        // Cache warm failed — non-critical, just serve the DB count
      }
    }
    return dbCount
  }

// fallow-ignore-next-line unused-type
export type GetUnreadCount = ReturnType<typeof getUnreadCount>
