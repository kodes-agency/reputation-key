// Inbox context — get new count use case
// Returns the new count for the caller: org-wide (cached) for org-wide scope,
// scoped to assigned properties (DB) for assigned scope (PropertyManager/Staff).
//
// Design note: the counter is org-wide (see NewCounterPort). Only an org-wide
// caller uses the cached counter; assigned-scope callers bypass it (the
// org-wide value would overcount for them) and read the scoped DB count.

import type { NewCounterPort } from '../ports/new-counter.port'
import type { InboxRepository } from '../ports/inbox.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../../domain/errors'

export type GetNewCountInput = Readonly<Record<string, never>>

// fallow-ignore-next-line unused-type
export type GetNewCountDeps = Readonly<{
  newCounter: NewCounterPort
  repo: InboxRepository
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
}>

export const getNewCount =
  (deps: GetNewCountDeps) =>
  async (_input: GetNewCountInput, ctx: AuthContext): Promise<number> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Scope resolved per-permission: null = org-wide (no lookup cost); else the
    // caller's assigned-property set. isOrgWide drives the Redis fast path.
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'inbox.read',
    )
    const isOrgWide = accessible === null

    // 1. Org-wide fast path: the org-wide counter is correct for the only
    //    org-scoped role. Assigned-scope callers MUST skip it — it holds the
    //    org-wide count, which would overcount them (their new items are
    //    scoped to their staff_assignment properties). They go straight to the
    //    scoped repo below.
    if (isOrgWide) {
      try {
        const count = await deps.newCounter.getCount(ctx.organizationId)
        if (count > 0) return count
      } catch (e) {
        deps.logger.warn(
          { err: e },
          'New counter unavailable, falling back to repo count',
        )
      }
    }

    // 2. Scoped repo count (always for assigned-scope; fallback for org-wide).
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (!isOrgWide) {
      // No assignments → no visible new items. propertyIds=[] would mean "no
      // filter" (org-wide) at the repo, so short-circuit to 0 to avoid leaking
      // org-wide counts to a scoped user with no assignments.
      if (accessible.length === 0) return 0
      propertyIds = accessible
    }

    const dbCount = await deps.repo.countByStatus(ctx.organizationId, 'new', propertyIds)

    // Warm the org-wide counter ONLY for org-wide callers — a scoped dbCount
    // must not pollute the org-wide key (it would undercount the next admin read).
    if (isOrgWide && dbCount > 0) {
      try {
        await deps.newCounter.setCount(ctx.organizationId, dbCount)
      } catch (err) {
        deps.logger.warn(
          { err, organizationId: ctx.organizationId },
          'Cache warm failed — non-critical, just serve the DB count',
        )
      }
    }
    return dbCount
  }

// fallow-ignore-next-line unused-type
export type GetNewCount = ReturnType<typeof getNewCount>
