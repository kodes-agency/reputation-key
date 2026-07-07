// Inbox context — get new count use case
// Returns the new count for the caller: org-wide (cached) for AccountAdmin,
// scoped to assigned properties (DB) for PropertyManager/Staff.
//
// Design note: the counter is org-wide (see NewCounterPort). Only AccountAdmin
// is org-scoped, so only they use the cached counter; PM/Staff bypass it (the
// org-wide value would overcount for them) and read the scoped DB count.

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

    const isOrgWide = input.role === 'AccountAdmin'

    // 1. AccountAdmin fast path: the org-wide counter is correct for the only
    //    org-scoped role. PM/Staff MUST skip it — it holds the org-wide count,
    //    which would overcount them (their new items are scoped to their
    //    staff_assignment properties). They go straight to the scoped repo below.
    if (isOrgWide) {
      try {
        const count = await deps.newCounter.getCount(input.organizationId)
        if (count > 0) return count
      } catch (e) {
        deps.logger.warn(
          { err: e },
          'New counter unavailable, falling back to repo count',
        )
      }
    }

    // 2. Scoped repo count (always for PM/Staff; fallback for AccountAdmin).
    // PM holds inbox.manage but is NOT org-wide (CONTEXT.md L72).
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (!isOrgWide) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        false,
      )
      // No assignments → no visible new items. propertyIds=[] would mean "no
      // filter" (org-wide) at the repo, so short-circuit to 0 to avoid leaking
      // org-wide counts to a scoped user with no assignments.
      if (accessible !== null && accessible.length === 0) return 0
      propertyIds = accessible ?? undefined
    }

    const dbCount = await deps.repo.countByStatus(
      input.organizationId,
      'new',
      propertyIds,
    )

    // Warm the org-wide counter ONLY for AccountAdmin — a scoped dbCount must
    // not pollute the org-wide key (it would undercount the next admin read).
    if (isOrgWide && dbCount > 0) {
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
