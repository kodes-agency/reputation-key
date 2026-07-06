// Inbox context — get new count use case
// Returns the new count for an org, with fallback to repo count.
//
// Design note: New count is org-level (see NewCounterPort for rationale).
// userId is NOT part of the counter scope.

import type { NewCounterPort } from '../ports/new-counter.port'
import type { InboxRepository } from '../ports/inbox.repository'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'

export type GetNewCountInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type GetNewCountDeps = Readonly<{
  newCounter: NewCounterPort
  repo: InboxRepository
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
}>

export const getNewCount =
  (deps: GetNewCountDeps) =>
  async (input: GetNewCountInput): Promise<number> => {
    if (!can(input.role, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // 1. Try counter first.
    // TODO(counter-key, ccInbox MAJOR): the new counter is keyed by orgId only
    //    (see NewCounterPort design note), so it holds the ORG-WIDE new count.
    //    When warm, step 1 returns that org-wide count to ALL roles — including
    //    PropertyManager/Staff, who must be scoped to their assigned properties.
    //    Fully scoping them needs a per-(org, accessiblePropertyIds) counter key
    //    (or per role-scope invalidation), which is a separate piece of work
    //    tracked as the ccInbox MAJOR finding. Until then, scoped roles only
    //    receive a correctly-scoped count via the DB-fallback path below (when
    //    the counter is cold/unavailable). AccountAdmin is correct either way.
    //    CHANGELOG: when the counter key becomes per-scope, remove this note
    //    and route PM/Staff through the scoped count unconditionally.
    try {
      const count = await deps.newCounter.getCount(input.organizationId)
      if (count > 0) return count
    } catch (e) {
      // Counter unavailable, fall through to repo
      deps.logger.warn({ err: e }, 'New counter unavailable, falling back to repo count')
    }

    // 2. Fallback: count from repo, warm the counter cache.
    // Resolve property scoping: AccountAdmin sees org-wide; PropertyManager/Staff
    // are scoped to their staff_assignment properties.
    // (PM holds inbox.manage but is NOT org-wide — CONTEXT.md L72.)
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (input.role !== 'AccountAdmin') {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
      // No assignments → no visible new items. The repo treats propertyIds=[]
      // as "no filter" (org-wide), so short-circuit to 0 to avoid leaking
      // org-wide counts to a scoped user with no property assignments.
      // (The warm-counter path above is still org-wide — see ccInbox MAJOR TODO.)
      if (accessible !== null && accessible.length === 0) return 0
      propertyIds = accessible ?? undefined
    }

    const dbCount = await deps.repo.countByStatus(
      input.organizationId,
      'new',
      propertyIds,
    )
    if (dbCount > 0) {
      try {
        await deps.newCounter.setCount(input.organizationId, dbCount)
      } catch (err) {
        deps.logger.warn(
          { err, organizationId: input.organizationId },
          'Cache warm failed — non-critical, just serve the DB count',
        )
      }
    }
    return dbCount
  }

// fallow-ignore-next-line unused-type
export type GetNewCount = ReturnType<typeof getNewCount>
