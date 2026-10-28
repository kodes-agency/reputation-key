// Inbox context — escalate inbox item use case
// Sets the orthogonal escalation flag (ADR 0055). Independent of status —
// an item can be escalated regardless of open/closed. Records the standalone
// `inbox.inbox_item.escalated` event (not a status transition).

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxItemEscalated } from '../../domain/events'
import { loadItemForCommand } from '../inbox-access'

export type EscalateInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
}>

export type EscalateInboxItemDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export type EscalateInboxItem = (
  input: EscalateInboxItemInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export const escalateInboxItem =
  (deps: EscalateInboxItemDeps): EscalateInboxItem =>
  async (input, ctx) => {
    // 1. Write permission, the item, its source and Property scope, then the
    //    revision fence — the order every single-item command shares.
    const item = await loadItemForCommand(deps, input, ctx)

    // 2. Idempotent: already escalated (active flag) — no-op return
    if (item.isEscalated && item.escalationResolvedAt === null) {
      return item
    }

    // 3. Set the escalation flag + record the standalone escalated fact
    //    atomically (decoupled from status_changed)
    const now = deps.clock()
    const escalatedBy: UserId = ctx.userId
    return deps.commandStore.escalate(
      item,
      { escalatedBy },
      inboxItemEscalated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: ctx.userId,
        occurredAt: now,
      }),
      now,
    )
  }
