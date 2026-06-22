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

    // 1. Try counter first
    try {
      const count = await deps.newCounter.getCount(input.organizationId)
      if (count > 0) return count
    } catch (e) {
      // Counter unavailable, fall through to repo
      deps.logger.warn({ err: e }, 'New counter unavailable, falling back to repo count')
    }

    // 2. Fallback: count from repo, warm the counter cache
    // Resolve property scoping for roles without inbox.manage (Staff).
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (!can(input.role, 'inbox.manage')) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
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
