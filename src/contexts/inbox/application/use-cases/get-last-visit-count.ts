// Inbox context — get last-visit count use case
// Replaces the former org-level "new" badge (ADR 0023). Returns the count of
// `open` items created since the caller's per-user `lastInboxView` timestamp.
// Per-user — no shared org-level counter corruption.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../../domain/errors'

export type GetLastVisitCountInput = Readonly<Record<string, never>>

export type GetLastVisitCountDeps = Readonly<{
  repo: InboxRepository
  viewRepo: InboxViewRepository
  staffPublicApi: StaffPublicApi
}>

export type GetLastVisitCount = (
  input: GetLastVisitCountInput,
  ctx: AuthContext,
) => Promise<number>

export const getLastVisitCount =
  (deps: GetLastVisitCountDeps): GetLastVisitCount =>
  async (_input, ctx) => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Scope resolved per-permission: null = org-wide (no lookup cost); else the
    // caller's assigned-property set.
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'inbox.read',
    )

    // No assignments → no visible items. propertyIds=[] would mean "no filter"
    // (org-wide) at the repo, so short-circuit to 0 to avoid leaking org-wide
    // counts to a scoped user with no assignments.
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (accessible !== null) {
      if (accessible.length === 0) return 0
      propertyIds = accessible
    }

    const since = await deps.viewRepo.getLastInboxView(ctx.organizationId, ctx.userId)

    return deps.repo.countOpenSince(ctx.organizationId, since, propertyIds)
  }
