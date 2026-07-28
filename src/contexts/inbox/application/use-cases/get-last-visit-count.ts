// Inbox context — get last-visit count use case
// Replaces the former org-level "new" badge (ADR 0023). Returns the count of
// `open` items created since the caller's per-user `lastInboxView` timestamp.
// Per-user — no shared org-level counter corruption.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { resolveVisiblePropertyIds } from '../visible-properties'

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
    // Scope resolved per-permission: 'all' = org-wide (no lookup cost);
    // 'none' = assigned scope with zero assignments → fail-closed zero.
    const visible = await resolveVisiblePropertyIds(
      deps.staffPublicApi,
      ctx,
      'inbox.read',
    )
    if (visible === 'none') return 0
    const propertyIds = visible === 'all' ? undefined : visible

    const since = await deps.viewRepo.getLastInboxView(ctx.organizationId, ctx.userId)

    return deps.repo.countOpenSince(ctx.organizationId, since, propertyIds)
  }
