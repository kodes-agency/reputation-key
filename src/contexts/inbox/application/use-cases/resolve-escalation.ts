// Inbox context — resolve escalation use case
// Clears the orthogonal escalation flag (ADR 0023). Independent of status.
// Emits the standalone `inbox.inbox_item.escalation_resolved` event.

import type { InboxRepository } from '../ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxItemEscalationResolved } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type ResolveEscalationInput = Readonly<{
  inboxItemId: InboxItemId
}>

export type ResolveEscalationDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
  outboxRepo?: OutboxRepository
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

    // 3. Resolve the escalation flag
    const now = deps.clock()
    const resolvedBy: UserId = ctx.userId
    const updated = await deps.repo.resolveEscalation(
      input.inboxItemId,
      ctx.organizationId,
      resolvedBy,
      now,
    )

    // 4. Emit standalone escalation_resolved event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      inboxItemEscalationResolved({
        inboxItemId: updated.id,
        organizationId: updated.organizationId,
        propertyId: item.propertyId,
        userId: ctx.userId,
        occurredAt: now,
      }),
    )

    return updated
  }
