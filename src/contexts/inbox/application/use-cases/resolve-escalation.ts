// Inbox context — resolve escalation use case
// Clears the orthogonal escalation flag (ADR 0023). Independent of status.
// Emits the standalone `inbox.inbox_item.escalation_resolved` event.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxItemEscalationResolved } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

export type ResolveEscalationInput = Readonly<{
  inboxItemId: InboxItemId
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
