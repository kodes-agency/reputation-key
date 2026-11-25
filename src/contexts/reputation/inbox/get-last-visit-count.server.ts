// Inbox context — get last-visit count use case
// Replaces the former org-level "new" badge (ADR 0057). Returns the count of
// `open` items created since the caller's per-user `lastInboxView` timestamp.
// Per-user — no shared org-level counter corruption.

import type { InboxRepository } from './inbox-repository.port.server'
import type { InboxViewRepository } from './inbox-view-repository.port.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { resolveVisiblePropertyIds } from './visible-properties.server'
import {
  onceAccessiblePropertyIds,
  resolveInboxSourceScopes,
} from './inbox-access.server'

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
    const people = onceAccessiblePropertyIds(deps.staffPublicApi)
    const visible = await resolveVisiblePropertyIds(people, ctx, 'inbox.read')
    if (visible === 'none') return 0
    const propertyIds = visible === 'all' ? undefined : visible
    const sourceScopes = await resolveInboxSourceScopes(people, ctx, 'read')
    if (sourceScopes.length === 0) return 0

    const since = await deps.viewRepo.getLastInboxView(ctx.organizationId, ctx.userId)

    return deps.repo.countOpenSince(ctx.organizationId, since, propertyIds, sourceScopes)
  }
