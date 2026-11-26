// Inbox context — get last-visit count use case
// Replaces the former org-level "new" badge (ADR 0057). Returns the count of
// `open` items created since the caller's per-user `lastInboxView` timestamp.
// Per-user — no shared org-level counter corruption.

import type { InboxRepository } from './inbox-repository.port.server'
import type { InboxViewRepository } from './inbox-view-repository.port.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { resolveInboxCountScope } from './inbox-count-scope.server'

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
    const scope = await resolveInboxCountScope(deps.staffPublicApi, ctx)
    if (!scope) return 0

    const since = await deps.viewRepo.getLastInboxView(ctx.organizationId, ctx.userId)

    return deps.repo.countOpenSince(
      ctx.organizationId,
      since,
      scope.propertyIds,
      scope.sourceScopes,
    )
  }
