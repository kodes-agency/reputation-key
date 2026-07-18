// Inbox context — escalate inbox item use case
// Sets the orthogonal escalation flag (ADR 0023). Independent of status —
// an item can be escalated regardless of open/closed. Emits the standalone
// `inbox.inbox_item.escalated` event (not a status transition).

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxItemEscalated } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

export type EscalateInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
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
    if (!canForContext(ctx, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')

    // 1. Find item + enforce role-scoped property access
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    await assertPropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'inbox.write',
      item.propertyId,
    )

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
