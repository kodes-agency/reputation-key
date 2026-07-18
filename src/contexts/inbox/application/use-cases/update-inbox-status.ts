// Inbox context — update inbox status use case
// Transitions status open ⇄ closed (ADR 0023). No source-type-conditional
// transitions — whether a review was replied to is a query on review data,
// not an inbox status. Escalation is a separate, orthogonal action.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId } from '#/shared/domain/ids'
import type { InboxStatus, InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
import { inboxItemStatusChanged } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  newStatus: InboxStatus
}>

export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export type UpdateInboxStatus = (
  input: UpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export const updateInboxStatus =
  (deps: UpdateInboxStatusDeps): UpdateInboxStatus =>
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

    // 2. Validate transition (open ⇄ closed). No source-type guards (ADR 0023).
    const transitionResult = validateTransition(item.status, input.newStatus)
    if (transitionResult.isErr()) {
      throw transitionResult.error
    }

    // 3. Update status + record the fact atomically (timestamp derived from
    //    target status — closedAt only)
    const now = deps.clock()
    return deps.commandStore.updateStatus(
      item,
      {
        status: input.newStatus,
        timestampFields: timestampFieldsForStatus(input.newStatus, now),
      },
      inboxItemStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: item.status,
        newStatus: input.newStatus,
        userId: ctx.userId,
        occurredAt: now,
      }),
      now,
    )
  }
