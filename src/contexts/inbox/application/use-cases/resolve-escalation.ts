// Inbox context — resolve escalation use case
// Clears the orthogonal escalation flag (ADR 0055). Independent of status.
// Records the standalone `inbox.inbox_item.escalation_resolved` event.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxItemEscalationResolved } from '../../domain/events'
import { loadItemForCommand } from '../inbox-access'

export type ResolveEscalationInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
}>

export type ResolveEscalationDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export type ResolveEscalation = (
  input: ResolveEscalationInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export const resolveEscalation =
  (deps: ResolveEscalationDeps): ResolveEscalation =>
  async (input, ctx) => {
    // 1. Write permission, the item, its source and Property scope, then the
    //    revision fence — the order every single-item command shares.
    const item = await loadItemForCommand(deps, input, ctx)

    // 2. Idempotent: not actively escalated — no-op return
    if (!item.isEscalated || item.escalationResolvedAt !== null) {
      return item
    }

    // 3. Resolve the escalation flag + record the standalone fact atomically
    const now = deps.clock()
    const resolvedBy: UserId = ctx.userId
    return deps.commandStore.resolveEscalation(
      item,
      { resolvedBy },
      inboxItemEscalationResolved({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: ctx.userId,
        occurredAt: now,
      }),
      now,
    )
  }
